/**
 * Ingest a NIST SP 800-63 revision from vendored single-page HTML into
 * data/spec/<rev>/spec.json (section tree with sanitized HTML) and
 * data/spec/<rev>/requirements/*.yaml (extracted normative requirements,
 * per chapter, stamped seededBy: parser / verified: false).
 *
 * The raw HTML is fetched once and committed; re-running the parse is
 * deterministic. Section numbers are derived from the heading walk
 * (data-section gives only the chapter; HTML ids are duplicated and unusable
 * as keys).
 *
 * Usage: npm run ingest -- --rev 800-63b-r4
 * The revision must exist in data/revisions.json (for sourceUrl + baseUrl).
 */
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import sanitizeHtml from 'sanitize-html';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import type {
  ChapterRequirements,
  ReqLevel,
  Requirement,
  RevisionMeta,
  SpecSection,
} from '../src/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseRevArg(): string {
  const idx = process.argv.indexOf('--rev');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return '800-63b-r4';
}
const REV = parseRevArg();

const registry: RevisionMeta[] = JSON.parse(
  readFileSync(path.join(ROOT, 'data/revisions.json'), 'utf8'),
);
const revMeta = registry.find((r) => r.revKey === REV);
if (!revMeta) {
  console.error(`Revision '${REV}' not found in data/revisions.json`);
  process.exit(1);
}

const REV_DIR = path.join(ROOT, 'data/spec', REV);
const RAW_PATH = path.join(REV_DIR, 'raw', `${revMeta.doc}.html`);
const ASSETS_DIR = path.join(REV_DIR, 'assets');
const REQ_DIR = path.join(REV_DIR, 'requirements');
const SPEC_URL = revMeta.sourceUrl;
const BASE_URL = SPEC_URL.replace(/[^/]+$/, ''); // strip filename

/** Sections whose keyword hits are definitional, not normative */
const EXCLUDED_TITLES = [
  'Notations',
  'Glossary',
  'Change Log',
  'References',
  'List of Symbols, Abbreviations, and Acronyms',
];

const KEYWORD_RE = /\b(SHALL NOT|SHALL|SHOULD NOT|SHOULD|MAY)\b/g;
const LEVEL_RANK: Record<ReqLevel, number> = {
  SHALL_NOT: 5,
  SHALL: 4,
  SHOULD_NOT: 3,
  SHOULD: 2,
  MAY: 1,
};

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function textHash(text: string): string {
  return createHash('sha256').update(normalize(text)).digest('hex').slice(0, 12);
}

function strongestKeyword(text: string): ReqLevel | null {
  let best: ReqLevel | null = null;
  for (const m of text.matchAll(KEYWORD_RE)) {
    const level = m[1].replace(' ', '_') as ReqLevel;
    if (!best || LEVEL_RANK[level] > LEVEL_RANK[best]) best = level;
  }
  return best;
}

async function ensureRawHtml(): Promise<string> {
  if (!existsSync(RAW_PATH)) {
    console.log(`Fetching ${SPEC_URL} ...`);
    const res = await fetch(SPEC_URL);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const html = await res.text();
    await mkdir(path.dirname(RAW_PATH), { recursive: true });
    await writeFile(RAW_PATH, html);
  }
  return readFile(RAW_PATH, 'utf8');
}

async function vendorAssets($: cheerio.CheerioAPI): Promise<void> {
  await mkdir(ASSETS_DIR, { recursive: true });
  const srcs = new Set<string>();
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src')!;
    if (!src.startsWith('http') && !src.startsWith('data:')) srcs.add(src);
  });
  for (const src of srcs) {
    const name = path.basename(src);
    const dest = path.join(ASSETS_DIR, name);
    if (existsSync(dest)) continue;
    const url = new URL(src, BASE_URL).href;
    console.log(`Fetching asset ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  skipped (${res.status})`);
      continue;
    }
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  }
}

interface WorkSection extends Omit<SpecSection, 'children' | 'html'> {
  bodyNodes: AnyNode[];
  children: WorkSection[];
  excluded: boolean;
}

/** Own text of an element, excluding nested lists (for li blocks) */
function ownText($: cheerio.CheerioAPI, el: Element): string {
  const clone = $(el).clone();
  clone.find('ul, ol').remove();
  return normalize(clone.text());
}

function main(html: string) {
  const $ = cheerio.load(html);

  // Content root: the div.row holding the document body (nav sits outside it).
  const contentRoot = $('h1#abstract').parent();
  if (contentRoot.length !== 1) throw new Error('Could not locate content root');

  // ---- Walk headings + siblings into a section tree -------------------------
  const roots: WorkSection[] = [];
  const stack: WorkSection[] = [];
  // Per-parent child counters keyed by parent number ('' = top level)
  const counters = new Map<string, number>();
  let unnumberedSeen = new Set<string>();

  for (const node of contentRoot.children().toArray()) {
    const tag = 'tagName' in node ? node.tagName?.toLowerCase() : undefined;
    const isHeading = tag && /^h[1-4]$/.test(tag);
    if (!isHeading) {
      if (stack.length) stack[stack.length - 1].bodyNodes.push(node);
      continue;
    }
    const level = Number(tag![1]);
    const $h = $(node);
    $h.find('a.header-link').remove();
    const title = normalize($h.text());
    const anchor = $h.attr('id') ?? '';
    const chapter = $h.attr('data-section') ?? '';

    // Pop to parent level
    while (stack.length >= level) stack.pop();

    let number: string;
    if (level === 1) {
      if (chapter) {
        number = chapter;
      } else {
        // Front/back matter: use a slug as the pseudo-number
        let slug = anchor || title.toLowerCase().replace(/\W+/g, '-');
        while (unnumberedSeen.has(slug)) slug += '-x';
        unnumberedSeen.add(slug);
        number = slug;
      }
    } else {
      const parent = stack[stack.length - 1];
      if (!parent) throw new Error(`h${level} "${title}" has no parent section`);
      const key = parent.number;
      const n = (counters.get(key) ?? 0) + 1;
      counters.set(key, n);
      number = `${key}.${n}`;
    }

    const excluded =
      EXCLUDED_TITLES.includes(title) ||
      (stack.length > 0 && stack[stack.length - 1].excluded);

    const section: WorkSection = {
      number,
      title,
      anchor,
      level,
      bodyNodes: [],
      children: [],
      excluded,
    };
    if (stack.length === 0) roots.push(section);
    else stack[stack.length - 1].children.push(section);
    stack.push(section);
  }

  // ---- Extract requirements + mark blocks -----------------------------------
  const requirements: Requirement[] = [];

  function addRequirement(
    el: Element,
    sectionNumber: string,
    ordinal: number,
    level: ReqLevel,
    text: string,
    source: 'prose' | 'table',
    context?: string,
  ): number {
    const id = `${sectionNumber}-R${ordinal}`;
    requirements.push({
      id,
      rev: REV,
      sectionNumber,
      ordinal,
      level,
      text,
      textHash: textHash(text),
      ...(context ? { context } : {}),
      source,
      seededBy: 'parser',
      verified: false,
    });
    $(el).attr('data-req-id', id);
    $(el).attr('data-req-level', level);
    return ordinal + 1;
  }

  function extractFromSection(sec: WorkSection) {
    let ordinal = 1;
    if (!sec.excluded) {
      const blocks = $(sec.bodyNodes);
      /** Stem carried from a "The verifier SHALL:" paragraph to its list */
      let pendingStem: { text: string; level: ReqLevel } | null = null;

      for (const node of sec.bodyNodes) {
        const tag = 'tagName' in node ? node.tagName?.toLowerCase() : undefined;
        if (!tag) continue;
        const el = node as Element;

        if (tag === 'p') {
          const text = normalize($(el).text());
          const kw = strongestKeyword(text);
          pendingStem = null;
          if (kw && text.endsWith(':')) {
            pendingStem = { text, level: kw };
          } else if (kw) {
            ordinal = addRequirement(el, sec.number, ordinal, kw, text, 'prose');
          }
        } else if (tag === 'ul' || tag === 'ol') {
          const stem = pendingStem;
          pendingStem = null;
          for (const li of $(el).children('li').toArray()) {
            const liText = ownText($, li);
            const liKw = strongestKeyword(liText);
            if (stem) {
              const kw = liKw ?? stem.level;
              ordinal = addRequirement(
                li, sec.number, ordinal, kw, liText, 'prose', stem.text,
              );
            } else if (liKw) {
              ordinal = addRequirement(li, sec.number, ordinal, liKw, liText, 'prose');
            }
            // Nested lists under a keyword-bearing li: treat nested items with
            // their own keywords as requirements too
            for (const nested of $(li).find('li').toArray()) {
              const nText = ownText($, nested);
              const nKw = strongestKeyword(nText);
              if (nKw) {
                ordinal = addRequirement(
                  nested, sec.number, ordinal, nKw, nText, 'prose',
                  stem?.text ?? ownText($, li),
                );
              }
            }
          }
        } else if (tag === 'table' || $(el).find('table').length) {
          pendingStem = null;
          for (const cell of $(el).find('td, th').toArray()) {
            const text = normalize($(cell).text());
            const kw = strongestKeyword(text);
            if (kw) {
              ordinal = addRequirement(cell, sec.number, ordinal, kw, text, 'table');
            }
          }
        } else {
          pendingStem = null;
        }
        void blocks;
      }
    }
    for (const child of sec.children) extractFromSection(child);
  }
  for (const sec of roots) extractFromSection(sec);

  // ---- Serialize + sanitize -------------------------------------------------
  const sanitizeOpts: sanitizeHtml.IOptions = {
    allowedTags: [
      'p', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'b', 'i', 'code', 'pre',
      'table', 'thead', 'tbody', 'tr', 'td', 'th', 'caption', 'blockquote',
      'sup', 'sub', 'br', 'img', 'figure', 'figcaption', 'div', 'span',
      'h5', 'h6', 'dl', 'dt', 'dd',
    ],
    allowedAttributes: {
      '*': ['data-req-id', 'data-req-level', 'id', 'class'],
      a: ['href', 'data-req-id', 'data-req-level', 'class'],
      img: ['src', 'alt'],
      td: ['colspan', 'rowspan', 'data-req-id', 'data-req-level'],
      th: ['colspan', 'rowspan', 'data-req-id', 'data-req-level'],
    },
    transformTags: {
      a: (tagName, attribs) => {
        let href = attribs.href ?? '';
        // Resolve root-relative internal links (e.g. "/800-63-4/sp800-63a.html#s-2")
        // to absolute pages.nist.gov URLs. Derive the origin from BASE_URL so this
        // works for any document/revision, not just the /800-63-4/ family.
        if (href.startsWith('/')) {
          try {
            href = new URL(href, BASE_URL).href;
          } catch {
            /* leave as-is if BASE_URL isn't a valid base */
          }
        }
        return { tagName, attribs: { ...attribs, href } };
      },
      img: (tagName, attribs) => {
        const src = attribs.src ?? '';
        if (src && !src.startsWith('http') && !src.startsWith('data:')) {
          // Vendored at ingest; served by the dev server from data/spec/<rev>/assets
          return {
            tagName,
            attribs: { ...attribs, src: `/spec-assets/${REV}/assets/${path.basename(src)}` },
          };
        }
        return { tagName, attribs };
      },
    },
  };

  function toSpecSection(sec: WorkSection): SpecSection {
    const rawHtml = sec.bodyNodes.map((n) => $.html(n)).join('\n');
    return {
      number: sec.number,
      title: sec.title,
      anchor: sec.anchor,
      level: sec.level,
      html: sanitizeHtml(rawHtml, sanitizeOpts),
      children: sec.children.map(toSpecSection),
    };
  }
  const tree = roots.map(toSpecSection);

  return { tree, requirements };
}

function chapterOf(reqId: string): string {
  return reqId.split('.')[0].split('-')[0];
}

function slugForChapter(chapter: string, tree: SpecSection[]): string {
  const section = tree.find((s) => s.number === chapter);
  const title = section
    ? section.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : 'misc';
  const prefix = /^\d+$/.test(chapter) ? chapter.padStart(2, '0') : chapter;
  return `${prefix}-${title}`;
}

const html = await ensureRawHtml();
const $probe = cheerio.load(html);
await vendorAssets($probe);
const { tree, requirements } = main(html);

const ingestedAt = new Date().toISOString();

await mkdir(REV_DIR, { recursive: true });
await writeFile(
  path.join(REV_DIR, 'spec.json'),
  JSON.stringify({ source: SPEC_URL, ingestedAt, sections: tree }, null, 2),
);

// Requirements → per-chapter YAML (mirrors assessments layout)
await mkdir(REQ_DIR, { recursive: true });
const byChapter = new Map<string, Requirement[]>();
for (const req of requirements) {
  const c = chapterOf(req.id);
  byChapter.set(c, [...(byChapter.get(c) ?? []), req]);
}
for (const [chapter, reqs] of byChapter) {
  const sorted = reqs.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const data: ChapterRequirements = {
    chapter,
    rev: REV,
    requirements: Object.fromEntries(sorted.map((r) => [r.id, r])),
  };
  await writeFile(
    path.join(REQ_DIR, `${slugForChapter(chapter, tree)}.yaml`),
    YAML.stringify(data, { lineWidth: 100 }),
  );
}

// Stamp ingestedAt back into the registry entry
const updated = registry.map((r) => (r.revKey === REV ? { ...r, ingestedAt } : r));
await writeFile(
  path.join(ROOT, 'data/revisions.json'),
  JSON.stringify(updated, null, 2) + '\n',
);

const byLevel = requirements.reduce<Record<string, number>>((acc, r) => {
  acc[r.level] = (acc[r.level] ?? 0) + 1;
  return acc;
}, {});
console.log(`[${REV}] Sections: ${JSON.stringify(tree.map((s) => s.number))}`);
console.log(`[${REV}] Requirements: ${requirements.length}`, byLevel);
console.log(`[${REV}] Chapters written: ${byChapter.size}`);
