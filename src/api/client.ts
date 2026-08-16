import type {
  Assessment,
  Requirement,
  RequirementWithStatus,
  RevisionMeta,
  SpecSection,
} from '../types';

export type NavSection = Omit<SpecSection, 'html' | 'children'> & {
  children: NavSection[];
};

export interface DiscoveryJob {
  rev: string;
  reqId: string;
  state: 'queued' | 'running' | 'done' | 'error';
  startedAt: string;
  finishedAt?: string;
  message?: string;
  result?: { status: Assessment['status']; refCount: number };
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

const revPath = (rev: string) => `/api/rev/${encodeURIComponent(rev)}`;

export const api = {
  revisions: () => get<RevisionMeta[]>('/api/revisions'),
  sections: (rev: string) =>
    get<{ rev: string; source: string; ingestedAt: string; sections: NavSection[] }>(
      `${revPath(rev)}/spec/sections`,
    ),
  section: (rev: string, number: string) =>
    get<{ section: SpecSection; requirements: Requirement[] }>(
      `${revPath(rev)}/spec/sections/${encodeURIComponent(number)}`,
    ),
  requirements: (rev: string) =>
    get<RequirementWithStatus[]>(`${revPath(rev)}/spec/requirements`),
  setRequirementVerified: async (rev: string, reqId: string, verified: boolean) => {
    const res = await fetch(
      `${revPath(rev)}/spec/requirements/${encodeURIComponent(reqId)}/verified`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verified }),
      },
    );
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    return res.json() as Promise<Requirement>;
  },
  startDiscovery: async (rev: string, reqId: string) => {
    const res = await fetch(
      `${revPath(rev)}/spec/requirements/${encodeURIComponent(reqId)}/discover`,
      { method: 'POST' },
    );
    if (!res.ok) throw new Error(`Discovery failed to start: ${res.status}`);
    return res.json() as Promise<DiscoveryJob>;
  },
  discoveryStatus: (rev: string, reqId: string) =>
    get<DiscoveryJob>(
      `${revPath(rev)}/spec/requirements/${encodeURIComponent(reqId)}/discover`,
    ),
  assessment: (rev: string, reqId: string) =>
    get<Assessment>(`${revPath(rev)}/assessments/${encodeURIComponent(reqId)}`),
  saveAssessment: async (
    rev: string,
    a: Partial<Assessment> & { reqId: string },
  ) => {
    const res = await fetch(
      `${revPath(rev)}/assessments/${encodeURIComponent(a.reqId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(a),
      },
    );
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    return res.json() as Promise<Assessment>;
  },
  file: (path: string) =>
    get<{
      path: string;
      absPath: string;
      language: string;
      lineCount: number;
      content: string;
    }>(`/api/file?path=${encodeURIComponent(path)}`),
};
