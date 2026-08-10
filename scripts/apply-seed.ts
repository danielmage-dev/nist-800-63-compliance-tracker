/**
 * Merges a seed file (data/seeds/*.yaml) into data/assessments/*.yaml.
 *
 * Coexistence contract: an existing entry is only overwritten when
 * verified === false AND seededBy !== 'human'. Everything else is reported
 * as skipped and left untouched.
 *
 * Usage: npm run seed:apply -- data/seeds/03-passwords.yaml
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import type { Assessment, ChapterAssessments, Requirement } from '../src/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSESS_DIR = path.join(ROOT, 'data/assessments');
const REQS_PATH = path.join(ROOT, 'data/spec/requirements.json');

const seedArg = process.argv[2];
if (!seedArg) {
  console.error('Usage: npm run seed:apply -- <seed-file.yaml>');
  process.exit(1);
}
const seedPath = path.resolve(ROOT, seedArg);
if (!existsSync(seedPath)) {
  console.error(`Seed file not found: ${seedPath}`);
  process.exit(1);
}

const requirements: Requirement[] = JSON.parse(readFileSync(REQS_PATH, 'utf8'));
const requirementIds = new Set(requirements.map((r) => r.id));

const seed = YAML.parse(readFileSync(seedPath, 'utf8')) as {
  assessments: Record<string, Partial<Assessment>>;
};

// Load all chapter files, indexed by chapter
const files = new Map<string, { filePath: string; data: ChapterAssessments }>();
for (const file of readdirSync(ASSESS_DIR).filter((f) => f.endsWith('.yaml'))) {
  const filePath = path.join(ASSESS_DIR, file);
  const data = YAML.parse(readFileSync(filePath, 'utf8')) as ChapterAssessments;
  files.set(String(data.chapter), { filePath, data });
}

const chapterOf = (reqId: string) => reqId.split('.')[0].split('-')[0];

let applied = 0;
const skipped: string[] = [];
const unknown: string[] = [];
const touched = new Set<string>();

for (const [reqId, patch] of Object.entries(seed.assessments)) {
  if (!requirementIds.has(reqId)) {
    unknown.push(reqId);
    continue;
  }
  const chapter = chapterOf(reqId);
  const entry = files.get(chapter);
  if (!entry) {
    unknown.push(`${reqId} (no chapter file for ${chapter})`);
    continue;
  }
  const current = entry.data.assessments[reqId];
  if (current && (current.verified || current.seededBy === 'human')) {
    skipped.push(reqId);
    continue;
  }
  entry.data.assessments[reqId] = {
    reqId,
    status: patch.status ?? 'not-assessed',
    notes: patch.notes ?? '',
    refs: patch.refs ?? [],
    verified: false,
    seededBy: 'claude',
    updatedAt: new Date().toISOString(),
  };
  applied++;
  touched.add(chapter);
}

for (const chapter of touched) {
  const entry = files.get(chapter)!;
  const sorted: ChapterAssessments = {
    chapter,
    assessments: Object.fromEntries(
      Object.entries(entry.data.assessments).sort(([a], [b]) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
    ),
  };
  await writeFile(entry.filePath, YAML.stringify(sorted, { lineWidth: 100 }));
}

console.log(`Applied ${applied} seeded assessment(s) to ${touched.size} chapter file(s).`);
if (skipped.length) {
  console.log(`Skipped ${skipped.length} (verified or human-edited): ${skipped.join(', ')}`);
}
if (unknown.length) {
  console.error(`Unknown reqIds: ${unknown.join(', ')}`);
  process.exit(1);
}
