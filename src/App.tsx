import { Outlet, Link, useLocation } from 'react-router-dom';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import SectionNav from './components/nav/SectionNav';

export default function App() {
  const { pathname } = useLocation();
  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">
          NIST SP 800-63B <span className="rev">rev 4</span> · identity-idp tracker
        </span>
        <nav className="app-nav">
          <Link to="/section/1" className={pathname.startsWith('/section') ? 'active' : ''}>
            Spec
          </Link>
          <Link to="/dashboard" className={pathname === '/dashboard' ? 'active' : ''}>
            Dashboard
          </Link>
        </nav>
      </header>
      <PanelGroup direction="horizontal" autoSaveId="nist-tracker-outer" className="app-body">
        <Panel defaultSize={18} minSize={12} maxSize={30} className="nav-panel">
          <SectionNav />
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel>
          <Outlet />
        </Panel>
      </PanelGroup>
    </div>
  );
}
