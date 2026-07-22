import {ProjectsHubPage} from '#pages/projects-hub-page.js';
import type {ProjectsSearch} from '#routes/search.js';

export function HomeRouter({search = {}}: {search?: ProjectsSearch}) {
  return <ProjectsHubPage search={search.search ?? ''} />;
}
