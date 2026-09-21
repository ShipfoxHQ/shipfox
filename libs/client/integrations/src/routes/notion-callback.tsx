import {defineRoute} from '@shipfox/client-shell/runtime';
import {NotionCallbackPage} from '#pages/notion-callback-page.js';
import {parseNotionCallbackQuery} from '../notion-callback.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  validateSearch: parseNotionCallbackQuery,
  component: NotionCallbackPage,
});
