import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HighlighterCore } from 'shiki';
import { api } from '../../api/client';
import type { FileRef } from '../../types';

const WINDOW = 40;

let highlighterPromise: Promise<HighlighterCore> | null = null;
function getHighlighter() {
  highlighterPromise ??= import('shiki').then((shiki) =>
    shiki.createHighlighter({
      themes: ['github-dark'],
      langs: ['ruby', 'erb', 'yaml', 'typescript', 'tsx', 'javascript', 'json', 'html', 'scss', 'css', 'markdown', 'shellscript'],
    }),
  );
  return highlighterPromise;
}

export default function CodeViewer({ fileRef }: { fileRef: FileRef }) {
  const fileQ = useQuery({
    queryKey: ['file', fileRef.path],
    queryFn: () => api.file(fileRef.path),
    staleTime: 60_000,
  });
  const [html, setHtml] = useState('');
  const [expanded, setExpanded] = useState(false);
  const scrollTargetRef = useRef<HTMLDivElement>(null);

  const file = fileQ.data;
  const start = fileRef.startLine ?? 1;
  const end = fileRef.endLine ?? fileRef.startLine ?? Math.min(80, file?.lineCount ?? 80);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      const highlighter = await getHighlighter();
      const lines = file.content.split('\n');
      const sliceStart = expanded ? 1 : Math.max(1, start - WINDOW);
      const sliceEnd = expanded ? lines.length : Math.min(lines.length, end + WINDOW);
      const code = lines.slice(sliceStart - 1, sliceEnd).join('\n');
      const lang = highlighter.getLoadedLanguages().includes(file.language)
        ? file.language
        : 'text';
      const out = highlighter.codeToHtml(code, {
        lang,
        theme: 'github-dark',
        transformers: [
          {
            line(node, line) {
              const abs = sliceStart + line - 1;
              node.properties['data-line'] = abs;
              if (
                fileRef.startLine &&
                abs >= start &&
                abs <= (fileRef.endLine ?? start)
              ) {
                this.addClassToHast(node, 'hl-line');
              }
            },
          },
        ],
      });
      if (!cancelled) setHtml(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [file, expanded, start, end, fileRef.startLine, fileRef.endLine]);

  // Scroll the highlighted range into view within the code box
  useEffect(() => {
    if (!html || !fileRef.startLine) return;
    const el = scrollTargetRef.current?.querySelector('.hl-line');
    el?.scrollIntoView({ block: 'center' });
  }, [html, fileRef.startLine]);

  if (fileQ.isError) {
    return <div className="code-error">Could not read {fileRef.path}</div>;
  }
  if (!file || !html) return <div className="code-loading">Loading code…</div>;

  const vscodeHref = `vscode://file${file.absPath}${fileRef.startLine ? `:${fileRef.startLine}` : ''}`;

  return (
    <div className="code-viewer">
      <div className="code-toolbar">
        <a className="vscode-link" href={vscodeHref} title={file.absPath}>
          Open in VS Code
        </a>
        <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show window' : `Show full file (${file.lineCount} lines)`}
        </button>
      </div>
      <div
        className="code-body"
        ref={scrollTargetRef}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
