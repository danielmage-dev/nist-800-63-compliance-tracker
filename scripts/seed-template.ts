/**
 * Idempotent: writes a not-assessed skeleton entry for every requirement
 * in a revision that doesn't already have an assessment, grouped into
 * per-chapter YAML files. Never overwrites an existing entry.
 *
 * Usage: npm run seed:template -- --rev 800-63b-r4
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import type {
  Assessment,
  ChapterAssessments,
  ChapterRequirements,
  Requirement,
  SpecSection,
} from '../src/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseRevArg(): string {
  const idx = process.argv.indexOf('--rev');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return '800-63b-r4';
}
const REV = parseRevArg();

const REQ_DIR = path.join(ROOT, 'data/spec', REV, 'requirements');
const SPEC_PATH = path.join(ROOT, 'data/spec', REV, 'spec.json');
const ASSESS_DIR = path.join(ROOT, 'data/assessments', REV);

if (!existsSync(REQ_DIR)) {
  console.error(`No requirements for '${REV}' (run: npm run ingest -- --rev ${REV})`);
  process.exit(1);
}

const spec: { sections: SpecSection[] } = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));

const requirements: Requirement[] = [];
for (const file of readdirSync(REQ_DIR).filter((f) => f.endsWith('.yaml'))) {
  const data = YAML.parse(readFileSync(path.join(REQ_DIR, file), 'utf8')) as ChapterRequirements;
  requirements.push(...Object.values(data.requirements));
}

function slugForChapter(chapter: string): string {
  const section = spec.sections.find((s) => s.number === chapter);
  const title = section
    ? section.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : 'misc';
  const prefix = /^\d+$/.test(chapter) ? chapter.padStart(2, '0') : chapter;
  return `${prefix}-${title}`;
}

function chapterOf(reqId: string): string {
  return reqId.split('.')[0].split('-')[0];
}

if (!existsSync(ASSESS_DIR)) mkdirSync(ASSESS_DIR, { recursive: true });

const existing = new Map<string, ChapterAssessments>();
for (const file of readdirSync(ASSESS_DIR).filter((f) => f.endsWith('.yaml'))) {
  const data = YAML.parse(readFileSync(path.join(ASSESS_DIR, file), 'utf8')) as ChapterAssessments;
  existing.set(String(data.chapter), data);
}

let created = 0;
const byChapter = new Map<string, ChapterAssessments>(existing);

for (const req of requirements) {
  const chapter = chapterOf(req.id);
  let entry = byChapter.get(chapter);
  if (!entry) {
    entry = { chapter, rev: REV, assessments: {} };
    byChapter.set(chapter, entry);
  }
  if (!entry.assessments[req.id]) {
    const skeleton: Assessment = {
      reqId: req.id,
      rev: REV,
      status: 'not-assessed',
      notes: '',
      refs: [],
      verified: false,
      updatedAt: '',
    };
    entry.assessments[req.id] = skeleton;
    created++;
  }
}

for (const [chapter, data] of byChapter) {
  const sorted: ChapterAssessments = {
    chapter,
    rev: REV,
    assessments: Object.fromEntries(
      Object.entries(data.assessments).sort(([a], [b]) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
    ),
  };
  const filePath = path.join(ASSESS_DIR, `${slugForChapter(chapter)}.yaml`);
  await writeFile(filePath, YAML.stringify(sorted, { lineWidth: 100 }));
}

console.log(`[${REV}] Seeded ${created} new skeleton entries across ${byChapter.size} chapter files.`);
