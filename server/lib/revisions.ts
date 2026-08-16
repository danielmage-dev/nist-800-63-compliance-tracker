import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { RevisionMeta, RevisionStatus } from '../../src/types.ts';

const ROOT = process.cwd();
const REGISTRY_PATH = path.join(ROOT, 'data/revisions.json');

const VALID_STATUS: RevisionStatus[] = ['draft', 'final', 'superseded', 'active'];

let cache: RevisionMeta[] | null = null;

function validate(entry: unknown, i: number): RevisionMeta {
  const e = entry as Partial<RevisionMeta>;
  const require = (k: keyof RevisionMeta) => {
    if (typeof e[k] !== 'string' || !(e[k] as string).length) {
      throw new Error(`revisions.json[${i}]: missing or invalid '${k}'`);
    }
  };
  require('revKey');
  require('doc');
  require('rev');
  require('label');
  require('sourceUrl');
  require('ingestedAt');
  if (!VALID_STATUS.includes(e.status as RevisionStatus)) {
    throw new Error(`revisions.json[${i}]: invalid status '${e.status}'`);
  }
  return e as RevisionMeta;
}

export function listRevisions(): RevisionMeta[] {
  if (cache) return cache;
  if (!existsSync(REGISTRY_PATH)) {
    cache = [];
    return cache;
  }
  const parsed = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('revisions.json must be an array');
  }
  cache = parsed.map(validate);
  return cache;
}

export function getRevision(revKey: string): RevisionMeta | null {
  return listRevisions().find((r) => r.revKey === revKey) ?? null;
}

export function hasRevision(revKey: string): boolean {
  return getRevision(revKey) !== null;
}

/** The `active` revision if present, else the first, else null. */
export function defaultRevKey(): string | null {
  const revs = listRevisions();
  return (revs.find((r) => r.status === 'active') ?? revs[0])?.revKey ?? null;
}
