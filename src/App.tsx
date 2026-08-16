import { Outlet, Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useQuery } from '@tanstack/react-query';
import SectionNav from './components/nav/SectionNav';
import { api } from './api/client';

export default function App() {
  const { pathname } = useLocation();
  const { rev = '' } = useParams();
  const navigate = useNavigate();
  const revsQ = useQuery({ queryKey: ['revisions'], queryFn: api.revisions });
  const revs = revsQ.data ?? [];
  const current = revs.find((r) => r.revKey === rev);

  const onRevChange = (nextRev: string) => {
    // Preserve the current view (spec/dashboard) but reset to section 1 of the new rev.
    if (pathname.includes('/dashboard')) navigate(`/rev/${nextRev}/dashboard`);
    else navigate(`/rev/${nextRev}/section/1`);
  };

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">
          NIST {current?.label ?? rev}
          {current && <span className={`rev-status status-${current.status}`}>{current.status}</span>}
          {' '}· identity-idp tracker
        </span>
        <div className="app-header-right">
          {revs.length > 0 && (
            <select
              className="rev-select"
              value={rev}
              onChange={(e) => onRevChange(e.target.value)}
              aria-label="Revision"
            >
              {revs.map((r) => (
                <option key={r.revKey} value={r.revKey}>
                  {r.label} ({r.status})
                </option>
              ))}
            </select>
          )}
          <nav className="app-nav">
            <Link
              to={`/rev/${rev}/section/1`}
              className={pathname.includes('/section') ? 'active' : ''}
            >
              Spec
            </Link>
            <Link
              to={`/rev/${rev}/dashboard`}
              className={pathname.includes('/dashboard') ? 'active' : ''}
            >
              Dashboard
            </Link>
          </nav>
        </div>
      </header>
      <PanelGroup direction="horizontal" autoSaveId="nist-tracker-outer" className="app-body">
        <Panel defaultSize={18} minSize={12} maxSize={30} className="nav-panel">
          <SectionNav rev={rev} />
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel>
          <Outlet />
        </Panel>
      </PanelGroup>
    </div>
  );
}
