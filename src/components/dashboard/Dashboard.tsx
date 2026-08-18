import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { RequirementWithStatus, Status } from '../../types';
import { LEVEL_LABEL, STATUS_META, STATUS_ORDER } from '../../statusMeta';

function chapterOf(r: RequirementWithStatus): string {
  return r.sectionNumber.split('.')[0];
}

function StatCard({ title, reqs }: { title: string; reqs: RequirementWithStatus[] }) {
  const by = (s: Status) => reqs.filter((r) => r.status === s).length;
  return (
    <div className="stat-card">
      <div className="stat-title">{title}</div>
      <div className="stat-total">{reqs.length}</div>
      <div className="stat-breakdown">
        {STATUS_ORDER.map((s) =>
          by(s) ? (
            <span key={s} className={`stat-pill status-${s}`}>
              {by(s)} {STATUS_META[s].label.toLowerCase()}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

function Bar({ reqs }: { reqs: RequirementWithStatus[] }) {
  return (
    <div className="chapter-bar">
      {STATUS_ORDER.map((s) => {
        const n = reqs.filter((r) => r.status === s).length;
        if (!n) return null;
        return (
          <div
            key={s}
            className={`bar-seg status-${s}`}
            style={{ flexGrow: n }}
            title={`${n} ${STATUS_META[s].label}`}
          />
        );
      })}
    </div>
  );
}

function ReqList({ title, reqs, rev }: { title: string; reqs: RequirementWithStatus[]; rev: string }) {
  if (!reqs.length) return null;
  return (
    <div className="req-queue">
      <h3>{title} ({reqs.length})</h3>
      <ul>
        {reqs.map((r) => (
          <li key={r.id}>
            <Link to={`/rev/${encodeURIComponent(rev)}/section/${encodeURIComponent(r.sectionNumber)}/req/${encodeURIComponent(r.id)}`}>
              <span className={`level-chip level-${r.level.toLowerCase()}`}>
                {LEVEL_LABEL[r.level]}
              </span>
              <span className="queue-id">{r.id}</span>
              <span className="queue-text">{r.text.slice(0, 110)}…</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Dashboard() {
  const { rev = '' } = useParams();
  const reqsQ = useQuery({
    queryKey: ['requirements', rev],
    queryFn: () => api.requirements(rev),
    enabled: !!rev,
  });
  const sectionsQ = useQuery({
    queryKey: ['sections', rev],
    queryFn: () => api.sections(rev),
    enabled: !!rev,
  });
  const reqs = reqsQ.data ?? [];

  // Chapter titles come from the spec tree (top-level sections), so labels are
  // correct for any document/revision — not a hardcoded 800-63B map.
  const chapterTitles = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sectionsQ.data?.sections ?? []) m.set(s.number, s.title);
    return m;
  }, [sectionsQ.data]);

  const chapters = useMemo(() => {
    const m = new Map<string, RequirementWithStatus[]>();
    for (const r of reqs) {
      const c = chapterOf(r);
      m.set(c, [...(m.get(c) ?? []), r]);
    }
    return [...m.entries()].sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  }, [reqs]);

  if (reqsQ.isLoading) return <div className="spec-loading">Loading…</div>;

  const shalls = reqs.filter((r) => r.level === 'SHALL' || r.level === 'SHALL_NOT');
  const shoulds = reqs.filter((r) => r.level === 'SHOULD' || r.level === 'SHOULD_NOT');
  const mays = reqs.filter((r) => r.level === 'MAY');
  const gaps = reqs.filter((r) => r.status === 'gap');
  const unverifiedSeeded = reqs.filter(
    (r) => r.assessmentSeededBy === 'claude' && !r.assessed,
  );
  // Layer A: requirements the AI proposed (or flagged) that a human hasn't verified.
  const unverifiedReqs = reqs.filter(
    (r) => r.seededBy === 'claude' && !r.verified,
  );

  return (
    <div className="dashboard">
      <h2>Assessment Dashboard</h2>
      <div className="stat-cards">
        <StatCard title="SHALL / SHALL NOT" reqs={shalls} />
        <StatCard title="SHOULD / SHOULD NOT" reqs={shoulds} />
        <StatCard title="MAY" reqs={mays} />
      </div>

      <h3>By chapter</h3>
      <div className="chapter-rollups">
        {chapters.map(([c, list]) => (
          <div key={c} className="chapter-row">
            <Link className="chapter-label" to={`/rev/${encodeURIComponent(rev)}/section/${encodeURIComponent(c)}`}>
              {c}. {chapterTitles.get(c) ?? c}
            </Link>
            <Bar reqs={list} />
            <span className="chapter-count">
              {list.filter((r) => r.status !== 'not-assessed').length}/{list.length}
            </span>
          </div>
        ))}
      </div>

      <ReqList title="Gaps" reqs={gaps} rev={rev} />
      <ReqList title="AI-proposed requirements, awaiting review" reqs={unverifiedReqs} rev={rev} />
      <ReqList title="Claude-seeded assessments, awaiting review" reqs={unverifiedSeeded} rev={rev} />
    </div>
  );
}
