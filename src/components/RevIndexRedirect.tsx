import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router-dom';
import { api } from '../api/client';

/**
 * Resolves the landing revision and redirects to its first spec section.
 * Used for both `/` and `/rev/:rev` (index) so a bare URL always lands somewhere.
 */
export default function RevIndexRedirect() {
  const { rev } = useParams();
  const revsQ = useQuery({ queryKey: ['revisions'], queryFn: api.revisions });

  if (revsQ.isLoading) return <div className="spec-loading">Loading…</div>;
  const revs = revsQ.data ?? [];
  if (!revs.length) {
    return (
      <div className="spec-loading">
        No revisions ingested yet. Run <code>npm run ingest</code>.
      </div>
    );
  }
  const target =
    (rev && revs.find((r) => r.revKey === rev)?.revKey) ||
    revs.find((r) => r.status === 'active')?.revKey ||
    revs[0].revKey;

  return <Navigate to={`/rev/${encodeURIComponent(target)}/section/1`} replace />;
}
