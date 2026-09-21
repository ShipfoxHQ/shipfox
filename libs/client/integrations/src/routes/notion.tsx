import {defineRoute} from '@shipfox/client-shell/runtime';
import {NotionInstallPage} from '#pages/notion-install-page.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  component: NotionInstallPage,
});
