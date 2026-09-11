import {defineRoute} from '@shipfox/client-shell/runtime';
import {ClickUpCallbackPage} from '#pages/clickup-callback-page.js';
import {parseClickUpCallbackQuery} from '../clickup-callback.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  validateSearch: parseClickUpCallbackQuery,
  component: ClickUpCallbackPage,
});
