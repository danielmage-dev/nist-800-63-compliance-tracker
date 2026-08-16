import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { Assessment, FileRef, Status } from '../../types';
import { LEVEL_LABEL, STATUS_META, STATUS_ORDER } from '../../statusMeta';
import CodeViewer from './CodeViewer';
import RefEditor from './RefEditor';

export default function RequirementDetail({
  rev,
  reqId,
  sectionNumber,
}: {
  rev: string;
  reqId: string;
  sectionNumber: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reqsQ = useQuery({
    queryKey: ['requirements', rev],
    queryFn: () => api.requirements(rev),
    enabled: !!rev,
  });
  const requirement = useMemo(
    () => reqsQ.data?.find((r) => r.id === reqId),
    [reqsQ.data, reqId],
  );
  const assessQ = useQuery({
    queryKey: ['assessment', rev, reqId],
    queryFn: () => api.assessment(rev, reqId),
    enabled: !!rev,
  });

  const [draft, setDraft] = useState<Assessment | null>(null);
  useEffect(() => {
    setDraft(assessQ.data ?? null);
  }, [assessQ.data]);

  const saveMut = useMutation({
    mutationFn: (a: Partial<Assessment> & { reqId: string }) =>
      api.saveAssessment(rev, a),
    onSuccess: (saved) => {
      queryClient.setQueryData(['assessment', rev, reqId], saved);
      queryClient.invalidateQueries({ queryKey: ['requirements', rev] });
    },
  });

  const verifyReqMut = useMutation({
    mutationFn: (verified: boolean) =>
      api.setRequirementVerified(rev, reqId, verified),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requirements', rev] });
    },
  });

  // Agentic discovery (ADR-0006): "Find supporting code" — async job + polling.
  const [discovering, setDiscovering] = useState(false);
  const [discoveryMsg, setDiscoveryMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    // Reset discovery UI when switching requirements.
    setDiscovering(false);
    setDiscoveryMsg(null);
    clearInterval(pollRef.current);
  }, [rev, reqId]);
  useEffect(() => () => clearInterval(pollRef.current), []);

  const runDiscovery = async () => {
    setDiscovering(true);
    setDiscoveryMsg('Starting agent…');
    try {
      await api.startDiscovery(rev, reqId);
    } catch (e) {
      setDiscovering(false);
      setDiscoveryMsg(`Failed to start: ${(e as Error).message}`);
      return;
    }
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const job = await api.discoveryStatus(rev, reqId);
        setDiscoveryMsg(job.message ?? job.state);
        if (job.state === 'done' || job.state === 'error') {
          clearInterval(pollRef.current);
          setDiscovering(false);
          if (job.state === 'done') {
            // Refresh the assessment + requirements so the proposal shows.
            queryClient.invalidateQueries({ queryKey: ['assessment', rev, reqId] });
            queryClient.invalidateQueries({ queryKey: ['requirements', rev] });
          }
        }
      } catch {
        /* transient; keep polling */
      }
    }, 2500);
  };

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
          onClick={() => navigate(`/rev/${encodeURIComponent(rev)}/section/${encodeURIComponent(sectionNumber)}`)}
        >
          ×
        </button>
      </div>

      {requirement.context && (
        <p className="req-context">{requirement.context}</p>
      )}
      <blockquote className="req-text">{requirement.text}</blockquote>

      <div className="req-provenance">
        <span className={`seed-chip seed-${requirement.seededBy}`}>
          extraction: {requirement.seededBy}
        </span>
        <label className="verified-toggle">
          <input
            type="checkbox"
            checked={requirement.verified}
            disabled={verifyReqMut.isPending}
            onChange={(e) => verifyReqMut.mutate(e.target.checked)}
          />
          Requirement verified by human
        </label>
        {requirement.seededBy === 'claude' && !requirement.verified && (
          <span className="seeded-chip">AI-proposed requirement — review</span>
        )}
      </div>

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
          Assessment verified by human
        </label>
        {draft.seededBy === 'claude' && !draft.verified && (
          <span className="seeded-chip">Claude-seeded assessment — review</span>
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
          <button
            className="discover-btn"
            onClick={runDiscovery}
            disabled={discovering}
            title="Run the agent to find identity-idp code that implements this requirement"
          >
            {discovering ? 'Finding…' : 'Find supporting code'}
          </button>
        </div>
        {discoveryMsg && (
          <div className={`discovery-status ${discovering ? 'busy' : ''}`}>
            {discovering && <span className="spinner" aria-hidden />}
            {discoveryMsg}
          </div>
        )}
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
        <Link to={`/rev/${encodeURIComponent(rev)}/section/${encodeURIComponent(requirement.sectionNumber)}`}>
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
