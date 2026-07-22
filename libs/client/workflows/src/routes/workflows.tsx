import {defineRoute} from '@shipfox/client-shell/runtime';
import {useParams} from '@tanstack/react-router';
import {ProjectWorkflowsPage} from '#pages/project-workflows-page.js';

export default defineRoute({
  component: () => {
    const {pid} = useParams({strict: false}) as {pid: string};
    return <ProjectWorkflowsPage projectId={pid} />;
  },
});
