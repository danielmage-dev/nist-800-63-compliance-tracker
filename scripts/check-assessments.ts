/**
 * Validates data/assessments/*.yaml: schema shape, reqId existence, file
 * path existence under IDP_ROOT, line bounds, and snippet drift.
 * Exits non-zero on any error.
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import type { Assessment, ChapterAssessments, Requirement, Status } from '../src/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQS_PATH = path.join(ROOT, 'data/spec/requirements.json');
const ASSESS_DIR = path.join(ROOT, 'data/assessments');
const IDP_ROOT = realpathSync(
  process.env.IDP_ROOT ?? path.resolve(ROOT, '../identity-idp'),
);

const STATUSES: Status[] = [
  'compliant', 'partial', 'gap', 'not-assessed', 'not-applicable',
];

const requirements: Requirement[] = JSON.parse(readFileSync(REQS_PATH, 'utf8'));
const requirementIds = new Set(requirements.map((r) => r.id));

let errors = 0;
let warnings = 0;
const err = (msg: string) => { console.error(`ERROR: ${msg}`); errors++; };
const warn = (msg: string) => { console.warn(`WARN:  ${msg}`); warnings++; };

if (!existsSync(ASSESS_DIR)) {
  console.log('No assessments directory yet — nothing to check.');
  process.exit(0);
}

for (const file of readdirSync(ASSESS_DIR).filter((f) => f.endsWith('.yaml'))) {
  const filePath = path.join(ASSESS_DIR, file);
  let data: ChapterAssessments;
  try {
    data = YAML.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    err(`${file}: YAML parse failure: ${(e as Error).message}`);
    continue;
  }
  if (!data?.chapter || typeof data.assessments !== 'object') {
    err(`${file}: missing 'chapter' or 'assessments' key`);
    continue;
  }

  for (const [reqId, a] of Object.entries<Assessment>(data.assessments)) {
    const ctx = `${file}:${reqId}`;
    if (reqId !== a.reqId) err(`${ctx}: key/reqId mismatch ('${a.reqId}')`);
    if (!requirementIds.has(reqId)) err(`${ctx}: unknown requirement id (spec re-ingested?)`);
    if (!STATUSES.includes(a.status)) err(`${ctx}: invalid status '${a.status}'`);
    if (typeof a.verified !== 'boolean') err(`${ctx}: 'verified' must be boolean`);

    for (const ref of a.refs ?? []) {
      const resolved = path.resolve(IDP_ROOT, ref.path);
      if (!resolved.startsWith(IDP_ROOT + path.sep) && resolved !== IDP_ROOT) {
        err(`${ctx}: ref path escapes IDP_ROOT: ${ref.path}`);
        continue;
      }
      if (!existsSync(resolved)) {
        err(`${ctx}: ref file does not exist: ${ref.path}`);
        continue;
      }
      const lines = readFileSync(resolved, 'utf8').split('\n');
      if (ref.endLine && ref.endLine > lines.length) {
        err(`${ctx}: endLine ${ref.endLine} exceeds file length ${lines.length} (${ref.path})`);
      }
      if (ref.snippet && ref.startLine) {
        const windowStart = Math.max(0, ref.startLine - 1 - 20);
        const windowEnd = Math.min(lines.length, ref.startLine - 1 + 20);
        const nearby = lines.slice(windowStart, windowEnd).join('\n');
        if (!nearby.includes(ref.snippet)) {
          warn(`${ctx}: snippet not found within ±20 lines of ${ref.startLine} in ${ref.path} (drift?)`);
        }
      }
    }
  }
}

console.log(`\n${errors} error(s), ${warnings} warning(s).`);
process.exit(errors > 0 ? 1 : 0);
