/**
 * Idempotent: writes a not-assessed skeleton entry for every requirement
 * that doesn't already have an assessment, grouped into per-chapter YAML
 * files. Never overwrites an existing entry.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import type { Assessment, ChapterAssessments, Requirement, SpecSection } from '../src/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQS_PATH = path.join(ROOT, 'data/spec/requirements.json');
const SPEC_PATH = path.join(ROOT, 'data/spec/spec.json');
const ASSESS_DIR = path.join(ROOT, 'data/assessments');

const requirements: Requirement[] = JSON.parse(readFileSync(REQS_PATH, 'utf8'));
const spec: { sections: SpecSection[] } = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));

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
    entry = { chapter, assessments: {} };
    byChapter.set(chapter, entry);
  }
  if (!entry.assessments[req.id]) {
    const skeleton: Assessment = {
      reqId: req.id,
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
    assessments: Object.fromEntries(
      Object.entries(data.assessments).sort(([a], [b]) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
    ),
  };
  const filePath = path.join(ASSESS_DIR, `${slugForChapter(chapter)}.yaml`);
  await writeFile(filePath, YAML.stringify(sorted, { lineWidth: 100 }));
}

console.log(`Seeded ${created} new skeleton entries across ${byChapter.size} chapter files.`);
