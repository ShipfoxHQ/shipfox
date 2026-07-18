import {defineRoute} from '@shipfox/client-shell/runtime';
import {useParams} from '@tanstack/react-router';
import {WorkflowRunPage} from '#pages/workflow-run-page.js';

export default defineRoute({
  staticData: {layout: 'full-bleed'},
  component: () => {
    const {wid, pid} = useParams({strict: false}) as {wid: string; pid: string};
    return <WorkflowRunPage workspaceId={wid} projectId={pid} />;
  },
});
