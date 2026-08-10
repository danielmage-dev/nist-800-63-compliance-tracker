import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { RequirementWithStatus, SpecSection } from '../../types';
import { STATUS_META } from '../../statusMeta';

function SectionBlock({ section }: { section: SpecSection }) {
  const Tag = (`h${Math.min(section.level, 4)}` as unknown) as 'h2';
  return (
    <section className="spec-section" data-section-number={section.number}>
      <Tag className="spec-heading">
        <span className="spec-heading-num">{section.number}</span> {section.title}
      </Tag>
      {section.html && (
        <div
          className="spec-body"
          dangerouslySetInnerHTML={{ __html: section.html }}
        />
      )}
      {section.children.map((c) => (
        <SectionBlock key={c.number} section={c} />
      ))}
    </section>
  );
}

export default function SpecView({
  number,
  selectedReqId,
}: {
  number: string;
  selectedReqId?: string;
}) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const sectionQ = useQuery({
    queryKey: ['section', number],
    queryFn: () => api.section(number),
  });
  const reqsQ = useQuery({ queryKey: ['requirements'], queryFn: api.requirements });
  const statusById = useMemo(() => {
    const m = new Map<string, RequirementWithStatus>();
    for (const r of reqsQ.data ?? []) m.set(r.id, r);
    return m;
  }, [reqsQ.data]);

  // Decorate requirement blocks after each render of the raw spec HTML
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !sectionQ.data) return;
    root.querySelectorAll<HTMLElement>('[data-req-id]').forEach((el) => {
      const id = el.dataset.reqId!;
      el.classList.add('req-block');
      el.classList.add(`req-${(el.dataset.reqLevel ?? 'SHALL').toLowerCase()}`);
      const info = statusById.get(id);
      let badge = el.querySelector<HTMLElement>(':scope > .req-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'req-badge';
        badge.setAttribute('data-nonspec', '1');
        el.prepend(badge);
      }
      const status = info?.status ?? 'not-assessed';
      badge.textContent =
        status === 'not-assessed' ? id : `${id} · ${STATUS_META[status].label}`;
      badge.className = `req-badge status-${status}`;
      if (info?.refCount) {
        badge.textContent += ` · ${info.refCount} file${info.refCount > 1 ? 's' : ''}`;
      }
    });
  }, [sectionQ.data, statusById]);

  // Selection highlight + scroll
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !sectionQ.data) return;
    root
      .querySelectorAll('.req-selected')
      .forEach((el) => el.classList.remove('req-selected'));
    if (selectedReqId) {
      const el = root.querySelector(`[data-req-id="${CSS.escape(selectedReqId)}"]`);
      if (el) {
        el.classList.add('req-selected');
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, [selectedReqId, sectionQ.data]);

  const onClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-req-id]');
    if (!target) return;
    // Let real links inside requirement text work normally
    if ((e.target as HTMLElement).closest('a')) return;
    const id = target.dataset.reqId!;
    navigate(`/section/${encodeURIComponent(number)}/req/${encodeURIComponent(id)}`);
  };

  if (sectionQ.isLoading) return <div className="spec-loading">Loading…</div>;
  if (!sectionQ.data) return <div className="spec-loading">Section not found</div>;

  return (
    <div className="spec-view" ref={containerRef} onClick={onClick}>
      <SectionBlock section={sectionQ.data.section} />
    </div>
  );
}
