import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { Assessment, FileRef, Status } from '../../types';
import { LEVEL_LABEL, STATUS_META, STATUS_ORDER } from '../../statusMeta';
import CodeViewer from './CodeViewer';
import RefEditor from './RefEditor';

export default function RequirementDetail({
  reqId,
  sectionNumber,
}: {
  reqId: string;
  sectionNumber: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reqsQ = useQuery({ queryKey: ['requirements'], queryFn: api.requirements });
  const requirement = useMemo(
    () => reqsQ.data?.find((r) => r.id === reqId),
    [reqsQ.data, reqId],
  );
  const assessQ = useQuery({
    queryKey: ['assessment', reqId],
    queryFn: () => api.assessment(reqId),
  });

  const [draft, setDraft] = useState<Assessment | null>(null);
  useEffect(() => {
    setDraft(assessQ.data ?? null);
  }, [assessQ.data]);

  const saveMut = useMutation({
    mutationFn: api.saveAssessment,
    onSuccess: (saved) => {
      queryClient.setQueryData(['assessment', reqId], saved);
      queryClient.invalidateQueries({ queryKey: ['requirements'] });
    },
  });

  const save = (patch: Partial<Assessment>) => {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    saveMut.mutate(next);
  };

  // Debounced notes autosave
  const notesTimer = useRef<ReturnType<typeof setTimeout>>();
  const onNotesChange = (notes: string) => {
    if (!draft) return;
    setDraft({ ...draft, notes });
    clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      saveMut.mutate({ ...draft, notes });
    }, 750);
  };
  useEffect(() => () => clearTimeout(notesTimer.current), []);

  if (!requirement || !draft) {
    return <div className="detail-pane"><div className="spec-loading">Loading…</div></div>;
  }

  return (
    <div className="detail-pane">
      <div className="detail-header">
        <span className={`level-chip level-${requirement.level.toLowerCase()}`}>
          {LEVEL_LABEL[requirement.level]}
        </span>
        <span className="detail-id">{reqId}</span>
        {requirement.source === 'table' && <span className="table-chip">table</span>}
        <button
          className="close-btn"
          title="Close"
          onClick={() => navigate(`/section/${encodeURIComponent(sectionNumber)}`)}
        >
          ×
        </button>
      </div>

      {requirement.context && (
        <p className="req-context">{requirement.context}</p>
      )}
      <blockquote className="req-text">{requirement.text}</blockquote>

      <div className="detail-controls">
        <div className="status-picker" role="radiogroup" aria-label="Compliance status">
          {STATUS_ORDER.map((s: Status) => (
            <button
              key={s}
              className={`status-option status-${s} ${draft.status === s ? 'selected' : ''}`}
              onClick={() => save({ status: s })}
            >
              {STATUS_META[s].label}
            </button>
          ))}
        </div>
        <label className="verified-toggle">
          <input
            type="checkbox"
            checked={draft.verified}
            onChange={(e) => save({ verified: e.target.checked })}
          />
          Verified by human
        </label>
        {draft.seededBy === 'claude' && !draft.verified && (
          <span className="seeded-chip">Claude-seeded — review</span>
        )}
      </div>

      <textarea
        className="notes-editor"
        placeholder="Assessment notes…"
        value={draft.notes}
        onChange={(e) => onNotesChange(e.target.value)}
        rows={3}
      />
      <div className="save-state">
        {saveMut.isPending ? 'Saving…' : draft.updatedAt ? `Saved ${new Date(draft.updatedAt).toLocaleString()}` : ''}
      </div>

      <div className="refs">
        <div className="refs-header">
          <span>Mapped code ({draft.refs.length})</span>
        </div>
        {draft.refs.map((ref, i) => (
          <RefBlock
            key={`${ref.path}:${ref.startLine ?? 0}:${i}`}
            fileRef={ref}
            onRemove={() => save({ refs: draft.refs.filter((_, j) => j !== i) })}
          />
        ))}
        <RefEditor onAdd={(ref) => save({ refs: [...draft.refs, ref] })} />
      </div>

      <div className="detail-footer">
        <Link to={`/section/${encodeURIComponent(requirement.sectionNumber)}`}>
          Go to section {requirement.sectionNumber}
        </Link>
      </div>
    </div>
  );
}

function RefBlock({ fileRef, onRemove }: { fileRef: FileRef; onRemove: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="ref-block">
      <div className="ref-title">
        <button className="ref-toggle" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'}
        </button>
        <code className="ref-path">
          {fileRef.path}
          {fileRef.startLine ? `:${fileRef.startLine}` : ''}
          {fileRef.endLine && fileRef.endLine !== fileRef.startLine ? `–${fileRef.endLine}` : ''}
        </code>
        <button className="ref-remove" title="Remove mapping" onClick={onRemove}>
          remove
        </button>
      </div>
      {fileRef.note && <div className="ref-note">{fileRef.note}</div>}
      {open && <CodeViewer fileRef={fileRef} />}
    </div>
  );
}
