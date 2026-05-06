import {ProjectsHubPage} from '@shipfox/client-projects';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout/')({
  component: ProjectsHubPage,
});
