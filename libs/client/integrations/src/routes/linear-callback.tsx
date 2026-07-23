import {defineRoute} from '@shipfox/client-shell/runtime';
import {LinearCallbackPage} from '#pages/linear-callback-page.js';
import {parseLinearCallbackQuery} from '../linear-callback.js';

export default defineRoute({
  validateSearch: parseLinearCallbackQuery,
  component: LinearCallbackPage,
});
