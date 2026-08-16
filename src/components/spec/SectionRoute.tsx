import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useParams } from 'react-router-dom';
import SpecView from './SpecView';
import RequirementDetail from '../detail/RequirementDetail';

export default function SectionRoute() {
  const { rev = '', number = '1', reqId } = useParams();
  return (
    <PanelGroup direction="horizontal" autoSaveId="nist-tracker-inner">
      <Panel minSize={30}>
        <SpecView rev={rev} number={number} selectedReqId={reqId} />
      </Panel>
      {reqId && (
        <>
          <PanelResizeHandle className="resize-handle" />
          <Panel defaultSize={42} minSize={25} maxSize={60}>
            <RequirementDetail rev={rev} reqId={reqId} sectionNumber={number} />
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}
