import {defineRoute} from '@shipfox/client-shell/runtime';
import {DiscordInstallPage} from '#pages/discord-install-page.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  component: DiscordInstallPage,
});
