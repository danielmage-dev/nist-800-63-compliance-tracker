import { readFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type {
  Assessment,
  ChapterAssessments,
  ChapterRequirements,
  FileRef,
  Requirement,
  RequirementWithStatus,
  SpecSection,
} from '../../src/types.ts';
import { hasRevision } from './revisions.ts';

const ROOT = process.cwd();

interface SpecFile {
  source: string;
  ingestedAt: string;
  sections: SpecSection[];
}

interface RevStore {
  spec: SpecFile;
  requirements: Requirement[];
  requirementById: Map<string, Requirement>;
  /** chapter number -> { filePath, data } */
  chapters: Map<string, { filePath: string; data: ChapterAssessments }>;
  assessmentsFingerprint: string;
}

const stores = new Map<string, RevStore>();

function specPath(rev: string): string {
  return path.join(ROOT, 'data/spec', rev, 'spec.json');
}
function reqDir(rev: string): string {
  return path.join(ROOT, 'data/spec', rev, 'requirements');
}
function assessDir(rev: string): string {
  return path.join(ROOT, 'data/assessments', rev);
}

/** mtime+size of every assessment file, so out-of-band edits (seed scripts,
 *  hand edits, git checkouts) are picked up without restarting the server */
function assessmentsFingerprint(rev: string): string {
  const dir = assessDir(rev);
  if (!existsSync(dir)) return '';
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => {
      const s = statSync(path.join(dir, f));
      return `${f}:${s.mtimeMs}:${s.size}`;
    })
    .join('|');
}

function loadRequirements(rev: string): Requirement[] {
  const dir = reqDir(rev);
  if (!existsSync(dir)) return [];
  const out: Requirement[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    const data = YAML.parse(readFileSync(path.join(dir, file), 'utf8')) as ChapterRequirements;
    if (!data?.chapter || typeof data.requirements !== 'object') {
      throw new Error(`Malformed requirements file: ${path.join(dir, file)}`);
    }
    out.push(...Object.values(data.requirements));
  }
  out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return out;
}

function loadAssessmentsInto(rev: string, store: RevStore): void {
  store.chapters.clear();
  const dir = assessDir(rev);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    const filePath = path.join(dir, file);
    const data = YAML.parse(readFileSync(filePath, 'utf8')) as ChapterAssessments;
    if (!data?.chapter || typeof data.assessments !== 'object') {
      throw new Error(`Malformed assessment file: ${filePath}`);
    }
    store.chapters.set(String(data.chapter), { filePath, data });
  }
  store.assessmentsFingerprint = assessmentsFingerprint(rev);
}

function buildStore(rev: string): RevStore {
  const spec: SpecFile = JSON.parse(readFileSync(specPath(rev), 'utf8'));
  const requirements = loadRequirements(rev);
  const store: RevStore = {
    spec,
    requirements,
    requirementById: new Map(requirements.map((r) => [r.id, r])),
    chapters: new Map(),
    assessmentsFingerprint: '',
  };
  loadAssessmentsInto(rev, store);
  return store;
}

/** Get (and lazily build) the store for a revision. Refreshes assessments if stale. */
function getStore(rev: string): RevStore {
  if (!hasRevision(rev)) {
    throw Object.assign(new Error(`Unknown revision: ${rev}`), { status: 404 });
  }
  let store = stores.get(rev);
  if (!store) {
    store = buildStore(rev);
    stores.set(rev, store);
  } else if (assessmentsFingerprint(rev) !== store.assessmentsFingerprint) {
    loadAssessmentsInto(rev, store);
  }
  return store;
}

export function chapterOf(reqId: string): string {
  return reqId.split('.')[0].split('-')[0];
}

function slugForChapter(store: RevStore, chapter: string): string {
  const section = store.spec.sections.find((s) => s.number === chapter);
  const title = section
    ? section.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : 'misc';
  const prefix = /^\d+$/.test(chapter) ? chapter.padStart(2, '0') : chapter;
  return `${prefix}-${title}`;
}

function readAssessment(store: RevStore, rev: string, reqId: string): Assessment {
  const entry = store.chapters.get(chapterOf(reqId))?.data.assessments[reqId];
  return (
    entry ?? {
      reqId,
      rev,
      status: 'not-assessed',
      notes: '',
      refs: [],
      verified: false,
      updatedAt: '',
    }
  );
}

export function getSpec(rev: string): SpecFile {
  return getStore(rev).spec;
}

export function getAssessment(rev: string, reqId: string): Assessment {
  return readAssessment(getStore(rev), rev, reqId);
}

export async function putAssessment(rev: string, assessment: Assessment): Promise<Assessment> {
  const store = getStore(rev);
  const reqId = assessment.reqId;
  if (!store.requirementById.has(reqId)) {
    throw Object.assign(new Error(`Unknown requirement: ${reqId}`), { status: 404 });
  }
  const chapter = chapterOf(reqId);
  let entry = store.chapters.get(chapter);
  if (!entry) {
    const filePath = path.join(assessDir(rev), `${slugForChapter(store, chapter)}.yaml`);
    entry = { filePath, data: { chapter, rev, assessments: {} } };
    store.chapters.set(chapter, entry);
  }
  entry.data.assessments[reqId] = { ...assessment, rev };
  await writeChapter(rev, entry);
  return entry.data.assessments[reqId];
}

/** True if a record is locked against AI overwrite (human-verified or authored). */
export function isAssessmentLocked(rev: string, reqId: string): boolean {
  const a = getStore(rev).chapters.get(chapterOf(reqId))?.data.assessments[reqId];
  return !!a && (a.verified || a.seededBy === 'human');
}

/**
 * Write an AI-authored (agentic discovery) proposal, enforcing the provenance
 * human-lock: refuses if the existing record is verified or human-authored.
 * Always stamps seededBy:'claude', verified:false. Returns 'locked' (writes
 * nothing) or the saved Assessment.
 */
export async function proposeAssessment(
  rev: string,
  reqId: string,
  patch: { status: Assessment['status']; notes: string; refs: FileRef[] },
): Promise<Assessment | 'locked'> {
  if (isAssessmentLocked(rev, reqId)) return 'locked';
  return putAssessment(rev, {
    reqId,
    rev,
    status: patch.status,
    notes: patch.notes,
    refs: patch.refs,
    verified: false,
    seededBy: 'claude',
    updatedAt: new Date().toISOString(),
  });
}

async function writeChapter(
  rev: string,
  entry: { filePath: string; data: ChapterAssessments },
) {
  // Stable key order for reviewable diffs
  const sorted: ChapterAssessments = {
    chapter: entry.data.chapter,
    rev,
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

export function getRequirements(rev: string): Requirement[] {
  return getStore(rev).requirements;
}

/**
 * Set a requirement's own provenance (verify/unverify its extraction). This
 * writes to the per-chapter requirements YAML. Verifying stamps seededBy:'human'
 * so the record is thereafter protected from Layer A overwrite; unverifying
 * leaves seededBy as-is. Returns the updated requirement.
 */
export async function setRequirementVerified(
  rev: string,
  reqId: string,
  verified: boolean,
): Promise<Requirement> {
  const store = getStore(rev);
  const dir = reqDir(rev);
  const chapter = chapterOf(reqId);
  // Find the chapter file that contains this requirement.
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    const filePath = path.join(dir, file);
    const data = YAML.parse(readFileSync(filePath, 'utf8')) as ChapterRequirements;
    if (String(data.chapter) !== chapter || !data.requirements[reqId]) continue;
    const req = data.requirements[reqId];
    req.verified = verified;
    if (verified) req.seededBy = 'human';
    const sorted: ChapterRequirements = {
      chapter: data.chapter,
      rev,
      requirements: Object.fromEntries(
        Object.entries(data.requirements).sort(([a], [b]) =>
          a.localeCompare(b, undefined, { numeric: true }),
        ),
      ),
    };
    const tmp = filePath + '.tmp';
    await writeFile(tmp, YAML.stringify(sorted, { lineWidth: 100 }));
    await rename(tmp, filePath);
    // Refresh the in-memory store so subsequent reads see the change.
    const rebuilt = buildStore(rev);
    stores.set(rev, rebuilt);
    return rebuilt.requirementById.get(reqId)!;
  }
  throw Object.assign(new Error(`Unknown requirement: ${reqId}`), { status: 404 });
}

export function requirementsWithStatus(rev: string): RequirementWithStatus[] {
  const store = getStore(rev);
  return store.requirements.map((r) => {
    const a = readAssessment(store, rev, r.id);
    return {
      ...r,
      status: a.status,
      assessed: a.verified,
      ...(a.seededBy ? { assessmentSeededBy: a.seededBy } : {}),
      refCount: a.refs.length,
    };
  });
}

export function findSection(rev: string, number: string): SpecSection | null {
  const walk = (secs: SpecSection[]): SpecSection | null => {
    for (const s of secs) {
      if (s.number === number) return s;
      const found = walk(s.children);
      if (found) return found;
    }
    return null;
  };
  return walk(getStore(rev).spec.sections);
}
