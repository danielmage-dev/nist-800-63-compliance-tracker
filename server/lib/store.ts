import { readFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type {
  Assessment,
  ChapterAssessments,
  Requirement,
  RequirementWithStatus,
  SpecSection,
} from '../../src/types.ts';

const ROOT = process.cwd();
const SPEC_PATH = path.join(ROOT, 'data/spec/spec.json');
const REQS_PATH = path.join(ROOT, 'data/spec/requirements.json');
const ASSESS_DIR = path.join(ROOT, 'data/assessments');

interface SpecFile {
  source: string;
  ingestedAt: string;
  sections: SpecSection[];
}

export const spec: SpecFile = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
export const requirements: Requirement[] = JSON.parse(readFileSync(REQS_PATH, 'utf8'));

const requirementById = new Map(requirements.map((r) => [r.id, r]));

// chapter number -> { filePath, data }
const chapters = new Map<string, { filePath: string; data: ChapterAssessments }>();

let loadedFingerprint = '';

/** mtime+size of every assessment file, so out-of-band edits (seed scripts,
 *  hand edits, git checkouts) are picked up without restarting the server */
function fingerprint(): string {
  if (!existsSync(ASSESS_DIR)) return '';
  return readdirSync(ASSESS_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => {
      const s = statSync(path.join(ASSESS_DIR, f));
      return `${f}:${s.mtimeMs}:${s.size}`;
    })
    .join('|');
}

export function loadAssessments(): void {
  chapters.clear();
  if (!existsSync(ASSESS_DIR)) mkdirSync(ASSESS_DIR, { recursive: true });
  for (const file of readdirSync(ASSESS_DIR).filter((f) => f.endsWith('.yaml'))) {
    const filePath = path.join(ASSESS_DIR, file);
    const data = YAML.parse(readFileSync(filePath, 'utf8')) as ChapterAssessments;
    if (!data?.chapter || typeof data.assessments !== 'object') {
      throw new Error(`Malformed assessment file: ${filePath}`);
    }
    chapters.set(String(data.chapter), { filePath, data });
  }
  loadedFingerprint = fingerprint();
}

export function refreshIfStale(): void {
  if (fingerprint() !== loadedFingerprint) loadAssessments();
}

loadAssessments();

export function chapterOf(reqId: string): string {
  return reqId.split('.')[0].split('-')[0];
}

function slugForChapter(chapter: string): string {
  const section = spec.sections.find((s) => s.number === chapter);
  const title = section
    ? section.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : 'misc';
  const prefix = /^\d+$/.test(chapter) ? chapter.padStart(2, '0') : chapter;
  return `${prefix}-${title}`;
}

function readAssessment(reqId: string): Assessment {
  const entry = chapters.get(chapterOf(reqId))?.data.assessments[reqId];
  return (
    entry ?? {
      reqId,
      status: 'not-assessed',
      notes: '',
      refs: [],
      verified: false,
      updatedAt: '',
    }
  );
}

export function getAssessment(reqId: string): Assessment {
  refreshIfStale();
  return readAssessment(reqId);
}

export async function putAssessment(assessment: Assessment): Promise<Assessment> {
  const reqId = assessment.reqId;
  if (!requirementById.has(reqId)) {
    throw Object.assign(new Error(`Unknown requirement: ${reqId}`), { status: 404 });
  }
  const chapter = chapterOf(reqId);
  let entry = chapters.get(chapter);
  if (!entry) {
    const filePath = path.join(ASSESS_DIR, `${slugForChapter(chapter)}.yaml`);
    entry = { filePath, data: { chapter, assessments: {} } };
    chapters.set(chapter, entry);
  }
  entry.data.assessments[reqId] = assessment;
  await writeChapter(entry);
  return assessment;
}

async function writeChapter(entry: { filePath: string; data: ChapterAssessments }) {
  // Stable key order for reviewable diffs
  const sorted: ChapterAssessments = {
    chapter: entry.data.chapter,
    assessments: Object.fromEntries(
      Object.entries(entry.data.assessments).sort(([a], [b]) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
    ),
  };
  entry.data = sorted;
  const tmp = entry.filePath + '.tmp';
  await writeFile(tmp, YAML.stringify(sorted, { lineWidth: 100 }));
  await rename(tmp, entry.filePath);
}

export function requirementsWithStatus(): RequirementWithStatus[] {
  refreshIfStale();
  return requirements.map((r) => {
    const a = readAssessment(r.id);
    return {
      ...r,
      status: a.status,
      verified: a.verified,
      ...(a.seededBy ? { seededBy: a.seededBy } : {}),
      refCount: a.refs.length,
    };
  });
}

export function findSection(number: string): SpecSection | null {
  const walk = (secs: SpecSection[]): SpecSection | null => {
    for (const s of secs) {
      if (s.number === number) return s;
      const found = walk(s.children);
      if (found) return found;
    }
    return null;
  };
  return walk(spec.sections);
}
