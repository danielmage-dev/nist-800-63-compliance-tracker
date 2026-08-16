/**
 * Shared helpers for the agentic authoring scripts (Layers A and B):
 * - locating IDP_ROOT and reading source files within it (read-only boundary)
 * - loading requirements + assessments for a revision
 * - writing assessments back with the provenance human-lock enforced
 *
 * The write guardrail here mirrors scripts/apply-seed.ts: AI-authored writes are
 * always `seededBy: claude, verified: false`, and NEVER overwrite a record that
 * is `verified: true` or `seededBy: human`.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import type {
  Assessment,
  ChapterAssessments,
  ChapterRequirements,
  Requirement,
} from '../../src/types.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const IDP_ROOT = realpathSync(
  process.env.IDP_ROOT ?? path.resolve(ROOT, '../identity-idp'),
);

/** Resolve a repo-relative path safely inside IDP_ROOT; null if it escapes or is missing. */
export function resolveInIdp(relPath: string): string | null {
  if (!relPath || path.isAbsolute(relPath) || relPath.split(/[\\/]/).includes('..')) {
    return null;
  }
  const resolved = path.resolve(IDP_ROOT, relPath);
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    return null;
  }
  if (real !== IDP_ROOT && !real.startsWith(IDP_ROOT + path.sep)) return null;
  return real;
}

/** Read a slice of an identity-idp file (1-indexed, inclusive). Returns numbered lines. */
export function readIdpSlice(
  relPath: string,
  startLine?: number,
  endLine?: number,
): { text: string; lineCount: number } | null {
  const abs = resolveInIdp(relPath);
  if (!abs) return null;
  const lines = readFileSync(abs, 'utf8').split('\n');
  const from = startLine ? Math.max(1, startLine) : 1;
  const to = endLine ? Math.min(lines.length, endLine) : lines.length;
  const slice = lines
    .slice(from - 1, to)
    .map((l, i) => `${from + i}: ${l}`)
    .join('\n');
  return { text: slice, lineCount: lines.length };
}

function reqDir(rev: string): string {
  return path.join(ROOT, 'data/spec', rev, 'requirements');
}
function assessDir(rev: string): string {
  return path.join(ROOT, 'data/assessments', rev);
}

export function loadRequirements(rev: string): Requirement[] {
  const dir = reqDir(rev);
  if (!existsSync(dir)) {
    throw new Error(`No requirements for '${rev}' (run: npm run ingest -- --rev ${rev})`);
  }
  const out: Requirement[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    const data = YAML.parse(readFileSync(path.join(dir, file), 'utf8')) as ChapterRequirements;
    out.push(...Object.values(data.requirements));
  }
  out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return out;
}

export function chapterOf(reqId: string): string {
  return reqId.split('.')[0].split('-')[0];
}

interface ChapterFile {
  filePath: string;
  data: ChapterAssessments;
}

/** In-memory view of a revision's assessment chapter files, with a write-back API. */
export class AssessmentStore {
  private files = new Map<string, ChapterFile>();

  constructor(private rev: string, private specSections: { number: string; title: string }[]) {
    const dir = assessDir(rev);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
      const filePath = path.join(dir, file);
      const data = YAML.parse(readFileSync(filePath, 'utf8')) as ChapterAssessments;
      this.files.set(String(data.chapter), { filePath, data });
    }
  }

  get(reqId: string): Assessment | undefined {
    return this.files.get(chapterOf(reqId))?.data.assessments[reqId];
  }

  /** True if the record is locked against AI overwrite (human-verified or human-authored). */
  isLocked(reqId: string): boolean {
    const a = this.get(reqId);
    return !!a && (a.verified || a.seededBy === 'human');
  }

  private slugForChapter(chapter: string): string {
    const section = this.specSections.find((s) => s.number === chapter);
    const title = section
      ? section.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      : 'misc';
    const prefix = /^\d+$/.test(chapter) ? chapter.padStart(2, '0') : chapter;
    return `${prefix}-${title}`;
  }

  private ensureChapter(chapter: string): ChapterFile {
    let entry = this.files.get(chapter);
    if (!entry) {
      const filePath = path.join(assessDir(this.rev), `${this.slugForChapter(chapter)}.yaml`);
      entry = { filePath, data: { chapter, rev: this.rev, assessments: {} } };
      this.files.set(chapter, entry);
    }
    return entry;
  }

  /**
   * Write an AI-authored assessment proposal. Enforces the human-lock: returns
   * 'locked' (and writes nothing) if the existing record is verified or human.
   * Always stamps seededBy: 'claude', verified: false.
   */
  proposeClaude(
    reqId: string,
    patch: Pick<Assessment, 'status' | 'notes' | 'refs'>,
  ): 'written' | 'locked' {
    if (this.isLocked(reqId)) return 'locked';
    const chapter = chapterOf(reqId);
    const entry = this.ensureChapter(chapter);
    entry.data.assessments[reqId] = {
      reqId,
      rev: this.rev,
      status: patch.status,
      notes: patch.notes,
      refs: patch.refs,
      verified: false,
      seededBy: 'claude',
      updatedAt: new Date().toISOString(),
    };
    return 'written';
  }

  /** Persist every chapter file with stable key ordering. */
  async flush(): Promise<void> {
    for (const entry of this.files.values()) {
      const sorted: ChapterAssessments = {
        chapter: entry.data.chapter,
        rev: this.rev,
        assessments: Object.fromEntries(
          Object.entries(entry.data.assessments).sort(([a], [b]) =>
            a.localeCompare(b, undefined, { numeric: true }),
          ),
        ),
      };
      entry.data = sorted;
      await writeFile(entry.filePath, YAML.stringify(sorted, { lineWidth: 100 }));
    }
  }
}

export function loadSpecSections(rev: string): { number: string; title: string }[] {
  const specPath = path.join(ROOT, 'data/spec', rev, 'spec.json');
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as {
    sections: { number: string; title: string }[];
  };
  return spec.sections;
}
