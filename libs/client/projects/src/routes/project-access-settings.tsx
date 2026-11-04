import {defineRoute} from '@shipfox/client-shell/runtime';
import {ProjectAccessPage} from '#pages/project-access-page.js';

export default defineRoute({
  staticData: {frame: 'content'},
  component: ProjectAccessPage,
});
