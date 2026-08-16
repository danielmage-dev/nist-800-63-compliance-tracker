/**
 * In-app agentic discovery (ADR-0006).
 *
 * Runs the full OpenCode agent headlessly to find identity-idp code that
 * implements a requirement, then writes the result as a provenance-locked
 * proposal (seededBy:claude, verified:false). Jobs are async and tracked in an
 * in-memory registry keyed by `${rev}::${reqId}`, polled by the UI.
 *
 * The agent runs with `--dir IDP_ROOT`, giving it its native read-only tools
 * scoped to the identity-idp checkout. Egress is bounded by the sandbox
 * allowlist + OpenCode's own permissions (see ADR-0006); the tracker only
 * spawns the agent and parses its final JSON.
 */
import { spawn } from 'node:child_process';
import { realpathSync, createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { FileRef, Requirement, Status } from '../../src/types.ts';
import { getRequirements, proposeAssessment } from './store.ts';

const ROOT = process.cwd();
const IDP_ROOT = realpathSync(
  process.env.IDP_ROOT ?? path.resolve(ROOT, '../identity-idp'),
);
const AGENT_MODEL = process.env.DISCOVERY_MODEL ?? 'usai/claude_4_8_opus';
// Full-quality `build` agent investigations of a large codebase land in the
// ~2-3 min range (measured 119s and 173s); the old 180s ceiling clipped the
// upper end. 300s gives headroom without inviting runaway. Override with
// DISCOVERY_TIMEOUT_MS.
const AGENT_TIMEOUT_MS = Number(process.env.DISCOVERY_TIMEOUT_MS ?? 300_000);

export type JobState = 'queued' | 'running' | 'done' | 'error';
export interface DiscoveryJob {
  rev: string;
  reqId: string;
  state: JobState;
  startedAt: string;
  finishedAt?: string;
  message?: string;      // human-facing status / error
  result?: { status: Status; refCount: number };
  logPath?: string;      // transcript of the agent subprocess (for diagnosis)
}

const jobs = new Map<string, DiscoveryJob>();
const key = (rev: string, reqId: string) => `${rev}::${reqId}`;

export function getJob(rev: string, reqId: string): DiscoveryJob | undefined {
  return jobs.get(key(rev, reqId));
}

const VALID_STATUS: Status[] = [
  'compliant', 'partial', 'gap', 'not-assessed', 'not-applicable',
];

function taskPrompt(req: Requirement): string {
  return [
    `You are mapping a NIST SP 800-63 compliance requirement to the source code that implements it, in the identity-idp (login.gov) Ruby/Rails codebase rooted at your current working directory.`,
    ``,
    `Requirement ${req.id} (${req.level}):`,
    req.context ? `Context: ${req.context}` : '',
    req.text,
    ``,
    `Investigate the codebase (search, list directories, read files) and determine whether it implements this requirement. Cite the PRIMARY implementing code (validators, initializers, models, services, configuration), not incidental references. Read the exact lines you cite.`,
    ``,
    `Do not modify any files. When done, output ONLY a single JSON object on the final line, no prose, no markdown fences, of exactly this shape:`,
    `{"status":"compliant|partial|gap|not-applicable|not-assessed","notes":"2-4 sentences","refs":[{"path":"relative/path.rb","startLine":N,"endLine":M,"snippet":"verbatim code you read","note":"why this maps"}]}`,
    ``,
    `status meanings: compliant = code clearly & fully implements it; partial = partial or with caveats; gap = applies but not implemented; not-applicable = does not apply to this codebase's role; not-assessed = cannot determine from the code.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Extract the last JSON object from the agent's stdout (default text format). */
function extractJson(out: string): any | null {
  // Find the last balanced {...} block.
  const end = out.lastIndexOf('}');
  if (end === -1) return null;
  let depth = 0;
  for (let i = end; i >= 0; i--) {
    if (out[i] === '}') depth++;
    else if (out[i] === '{') {
      depth--;
      if (depth === 0) {
        const candidate = out.slice(i, end + 1);
        try { return JSON.parse(candidate); } catch { /* keep scanning */ }
      }
    }
  }
  return null;
}

/**
 * Spawn `opencode run` and stream its stdout/stderr to a log file AS IT RUNS,
 * so a timed-out or failed investigation still leaves a full transcript for
 * diagnosis. Resolves with captured stdout on clean exit; rejects (with the
 * partial log preserved on disk) on error/timeout.
 */
function runOpencode(prompt: string, logPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    mkdirSync(path.dirname(logPath), { recursive: true });
    const log = createWriteStream(logPath, { flags: 'a' });
    const t0 = Date.now();
    log.write(`=== discovery start ${new Date().toISOString()} ===\n`);
    log.write(`cmd: opencode run --model ${AGENT_MODEL} --dir ${IDP_ROOT}\n`);
    log.write(`prompt:\n${prompt}\n=== agent output ===\n`);

    const child = spawn(
      'opencode',
      [
        'run',
        '--model', AGENT_MODEL,
        '--dir', IDP_ROOT,
        // Headless: no TTY to answer permission prompts, so auto-approve tool
        // use (the agent is read-only against IDP_ROOT; it cannot write/execute
        // destructively here). Without this the agent hangs on its first tool
        // call waiting for approval that can never come.
        '--auto',
        prompt,
      ],
      { cwd: IDP_ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      log.write(`\n=== TIMEOUT after ${AGENT_TIMEOUT_MS}ms (killing agent) ===\n`);
      child.kill('SIGKILL');
    }, AGENT_TIMEOUT_MS);

    child.stdout.on('data', (d) => { const s = d.toString(); stdout += s; log.write(s); });
    child.stderr.on('data', (d) => { log.write(`[stderr] ${d.toString()}`); });
    child.on('error', (e) => {
      clearTimeout(timer);
      log.write(`\n=== spawn error: ${e.message} ===\n`);
      log.end();
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      log.write(`\n=== exit code ${code} after ${secs}s ===\n`);
      log.end();
      if (timedOut) {
        reject(new Error(`Agent timed out after ${AGENT_TIMEOUT_MS}ms (ran ${secs}s). See ${path.relative(ROOT, logPath)}`));
      } else if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`opencode exited ${code} after ${secs}s. See ${path.relative(ROOT, logPath)}`));
      }
    });
  });
}

function sanitizeRefs(refs: any): FileRef[] {
  if (!Array.isArray(refs)) return [];
  const out: FileRef[] = [];
  for (const r of refs) {
    if (!r?.path || typeof r.path !== 'string') continue;
    // Reject anything not inside IDP_ROOT (defense in depth; check re-validates).
    const abs = path.resolve(IDP_ROOT, r.path);
    if (abs !== IDP_ROOT && !abs.startsWith(IDP_ROOT + path.sep)) continue;
    out.push({
      path: r.path,
      ...(Number.isFinite(r.startLine) ? { startLine: Number(r.startLine) } : {}),
      ...(Number.isFinite(r.endLine) ? { endLine: Number(r.endLine) } : {}),
      ...(typeof r.snippet === 'string' ? { snippet: r.snippet } : {}),
      ...(typeof r.note === 'string' ? { note: r.note } : {}),
    });
  }
  return out;
}

/**
 * Start (or return the existing) discovery job for a requirement. Idempotent
 * while running: a second call during an active job returns the running job.
 */
export function startDiscovery(rev: string, reqId: string): DiscoveryJob {
  const existing = jobs.get(key(rev, reqId));
  if (existing && (existing.state === 'queued' || existing.state === 'running')) {
    return existing;
  }
  const req = getRequirements(rev).find((r) => r.id === reqId);
  if (!req) {
    throw Object.assign(new Error(`Unknown requirement: ${reqId}`), { status: 404 });
  }

  const logPath = path.join(
    ROOT, 'data/reviews', `${rev}-${reqId}-discovery-${Date.now()}.log`,
  );
  const job: DiscoveryJob = {
    rev, reqId, state: 'queued', startedAt: new Date().toISOString(),
    message: 'Agent starting…', logPath: path.relative(ROOT, logPath),
  };
  jobs.set(key(rev, reqId), job);

  // Fire-and-forget; the UI polls status.
  (async () => {
    job.state = 'running';
    job.message = 'Agent investigating the codebase…';
    try {
      const out = await runOpencode(taskPrompt(req), logPath);
      const parsed = extractJson(out);
      if (!parsed) {
        throw new Error(`Agent finished but returned no parseable JSON. See ${job.logPath}`);
      }
      const status: Status = VALID_STATUS.includes(parsed.status) ? parsed.status : 'not-assessed';
      const refs = sanitizeRefs(parsed.refs);
      const result = await proposeAssessment(rev, reqId, {
        status,
        notes: typeof parsed.notes === 'string' ? parsed.notes : '',
        refs,
      });
      if (result === 'locked') {
        job.state = 'error';
        job.message = 'This record is human-verified or human-authored; the agent did not overwrite it.';
      } else {
        job.state = 'done';
        job.message = `Proposed ${status} with ${refs.length} reference(s). Review and verify.`;
        job.result = { status, refCount: refs.length };
      }
    } catch (e) {
      job.state = 'error';
      job.message = (e as Error).message;
    } finally {
      job.finishedAt = new Date().toISOString();
    }
  })();

  return job;
}
