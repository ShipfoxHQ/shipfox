import {defineRoute} from '@shipfox/client-shell/runtime';
import {ClickUpInstallPage} from '#pages/clickup-install-page.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  component: ClickUpInstallPage,
});
