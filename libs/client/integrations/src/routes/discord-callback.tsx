import {defineRoute} from '@shipfox/client-shell/runtime';
import {DiscordCallbackPage} from '#pages/discord-callback-page.js';
import {parseDiscordCallbackQuery} from '../discord-callback.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  validateSearch: parseDiscordCallbackQuery,
  component: DiscordCallbackPage,
});
