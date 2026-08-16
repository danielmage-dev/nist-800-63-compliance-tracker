import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, useParams } from 'react-router-dom';
import { api, type NavSection } from '../../api/client';
import type { RequirementWithStatus } from '../../types';

interface Rollup {
  total: number;
  gaps: number;
  assessed: number;
}

function buildRollups(reqs: RequirementWithStatus[]): Map<string, Rollup> {
  const map = new Map<string, Rollup>();
  for (const r of reqs) {
    // Credit every ancestor section number: "3.1.1.2" -> 3, 3.1, 3.1.1, 3.1.1.2
    const parts = r.sectionNumber.split('.');
    for (let i = 1; i <= parts.length; i++) {
      const key = parts.slice(0, i).join('.');
      const roll = map.get(key) ?? { total: 0, gaps: 0, assessed: 0 };
      roll.total += 1;
      if (r.status === 'gap') roll.gaps += 1;
      if (r.status !== 'not-assessed') roll.assessed += 1;
      map.set(key, roll);
    }
  }
  return map;
}

function NavItem({
  section,
  rollups,
  activeNumber,
  rev,
}: {
  section: NavSection;
  rollups: Map<string, Rollup>;
  activeNumber?: string;
  rev: string;
}) {
  const roll = rollups.get(section.number);
  const isAncestorOfActive =
    activeNumber === section.number ||
    (activeNumber?.startsWith(section.number + '.') ?? false);
  const showChildren = isAncestorOfActive && section.children.length > 0;

  return (
    <li>
      <NavLink
        to={`/rev/${encodeURIComponent(rev)}/section/${encodeURIComponent(section.number)}`}
        className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
        end
      >
        <span className="nav-num">{/^\d|^[A-E]$/.test(section.number) ? section.number : ''}</span>
        <span className="nav-title">{section.title}</span>
        {roll && (
          <span className={`nav-count ${roll.gaps ? 'has-gap' : roll.assessed === roll.total ? 'done' : ''}`}>
            {roll.assessed}/{roll.total}
          </span>
        )}
      </NavLink>
      {showChildren && (
        <ul>
          {section.children.map((c) => (
            <NavItem key={c.number} section={c} rollups={rollups} activeNumber={activeNumber} rev={rev} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function SectionNav({ rev }: { rev: string }) {
  const { number } = useParams();
  const sectionsQ = useQuery({
    queryKey: ['sections', rev],
    queryFn: () => api.sections(rev),
    enabled: !!rev,
  });
  const reqsQ = useQuery({
    queryKey: ['requirements', rev],
    queryFn: () => api.requirements(rev),
    enabled: !!rev,
  });
  const rollups = useMemo(
    () => buildRollups(reqsQ.data ?? []),
    [reqsQ.data],
  );

  if (sectionsQ.isLoading) return <div className="nav-loading">Loading…</div>;
  if (!sectionsQ.data) return <div className="nav-loading">Failed to load spec</div>;

  return (
    <div className="section-nav">
      <ul>
        {sectionsQ.data.sections.map((s) => (
          <NavItem key={s.number} section={s} rollups={rollups} activeNumber={number} rev={rev} />
        ))}
      </ul>
    </div>
  );
}
