/**
 * Validates data/assessments/<rev>/*.yaml and data/spec/<rev>/requirements/*.yaml
 * for every revision in data/revisions.json (or a single --rev): schema shape,
 * reqId existence, rev consistency, file path existence under IDP_ROOT, line
 * bounds, and snippet drift. Exits non-zero on any error.
 *
 * Usage: npm run check [-- --rev 800-63b-r4]
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import type {
  Assessment,
  ChapterAssessments,
  ChapterRequirements,
  RevisionMeta,
  Status,
} from '../src/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IDP_ROOT = realpathSync(
  process.env.IDP_ROOT ?? path.resolve(ROOT, '../identity-idp'),
);

const STATUSES: Status[] = [
  'compliant', 'partial', 'gap', 'not-assessed', 'not-applicable',
];

function parseRevArg(): string | null {
  const idx = process.argv.indexOf('--rev');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

const registry: RevisionMeta[] = JSON.parse(
  readFileSync(path.join(ROOT, 'data/revisions.json'), 'utf8'),
);
const only = parseRevArg();
const revsToCheck = only ? registry.filter((r) => r.revKey === only) : registry;
if (only && !revsToCheck.length) {
  console.error(`Revision '${only}' not in data/revisions.json`);
  process.exit(1);
}

let errors = 0;
let warnings = 0;
const err = (msg: string) => { console.error(`ERROR: ${msg}`); errors++; };
const warn = (msg: string) => { console.warn(`WARN:  ${msg}`); warnings++; };

for (const revMeta of revsToCheck) {
  const REV = revMeta.revKey;
  const REQ_DIR = path.join(ROOT, 'data/spec', REV, 'requirements');
  const ASSESS_DIR = path.join(ROOT, 'data/assessments', REV);

  // ---- Requirements -------------------------------------------------------
  const requirementIds = new Set<string>();
  if (!existsSync(REQ_DIR)) {
    warn(`[${REV}] no requirements directory — run ingest`);
  } else {
    for (const file of readdirSync(REQ_DIR).filter((f) => f.endsWith('.yaml'))) {
      const ctx = `${REV}/${file}`;
      let data: ChapterRequirements;
      try {
        data = YAML.parse(readFileSync(path.join(REQ_DIR, file), 'utf8'));
      } catch (e) {
        err(`${ctx}: YAML parse failure: ${(e as Error).message}`);
        continue;
      }
      if (!data?.chapter || typeof data.requirements !== 'object') {
        err(`${ctx}: missing 'chapter' or 'requirements' key`);
        continue;
      }
      if (data.rev !== REV) err(`${ctx}: rev '${data.rev}' != '${REV}'`);
      for (const [reqId, r] of Object.entries(data.requirements)) {
        if (reqId !== r.id) err(`${ctx}:${reqId}: key/id mismatch ('${r.id}')`);
        if (r.rev !== REV) err(`${ctx}:${reqId}: rev '${r.rev}' != '${REV}'`);
        if (typeof r.verified !== 'boolean') err(`${ctx}:${reqId}: 'verified' must be boolean`);
        requirementIds.add(reqId);
      }
    }
  }

  // ---- Assessments --------------------------------------------------------
  if (!existsSync(ASSESS_DIR)) {
    console.log(`[${REV}] no assessments directory yet — nothing to check.`);
    continue;
  }

  for (const file of readdirSync(ASSESS_DIR).filter((f) => f.endsWith('.yaml'))) {
    const filePath = path.join(ASSESS_DIR, file);
    let data: ChapterAssessments;
    try {
      data = YAML.parse(readFileSync(filePath, 'utf8'));
    } catch (e) {
      err(`${REV}/${file}: YAML parse failure: ${(e as Error).message}`);
      continue;
    }
    if (!data?.chapter || typeof data.assessments !== 'object') {
      err(`${REV}/${file}: missing 'chapter' or 'assessments' key`);
      continue;
    }
    if (data.rev !== REV) err(`${REV}/${file}: rev '${data.rev}' != '${REV}'`);

    for (const [reqId, a] of Object.entries<Assessment>(data.assessments)) {
      const ctx = `${REV}/${file}:${reqId}`;
      if (reqId !== a.reqId) err(`${ctx}: key/reqId mismatch ('${a.reqId}')`);
      if (a.rev !== REV) err(`${ctx}: rev '${a.rev}' != '${REV}'`);
      if (requirementIds.size && !requirementIds.has(reqId)) {
        err(`${ctx}: unknown requirement id (spec re-ingested?)`);
      }
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
}

console.log(`\n${errors} error(s), ${warnings} warning(s).`);
process.exit(errors > 0 ? 1 : 0);
