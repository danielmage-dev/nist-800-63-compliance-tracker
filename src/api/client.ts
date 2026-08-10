import type {
  Assessment,
  Requirement,
  RequirementWithStatus,
  SpecSection,
} from '../types';

export type NavSection = Omit<SpecSection, 'html' | 'children'> & {
  children: NavSection[];
};

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export const api = {
  sections: () =>
    get<{ source: string; ingestedAt: string; sections: NavSection[] }>(
      '/api/spec/sections',
    ),
  section: (number: string) =>
    get<{ section: SpecSection; requirements: Requirement[] }>(
      `/api/spec/sections/${encodeURIComponent(number)}`,
    ),
  requirements: () => get<RequirementWithStatus[]>('/api/spec/requirements'),
  assessment: (reqId: string) =>
    get<Assessment>(`/api/assessments/${encodeURIComponent(reqId)}`),
  saveAssessment: async (a: Partial<Assessment> & { reqId: string }) => {
    const res = await fetch(`/api/assessments/${encodeURIComponent(a.reqId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a),
    });
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
