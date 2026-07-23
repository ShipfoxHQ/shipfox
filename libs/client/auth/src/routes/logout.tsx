import {defineRoute} from '@shipfox/client-shell/runtime';
import {LogoutPage} from '#pages/logout-page.js';
import {validateRedirectSearch} from './inputs.js';

export default defineRoute({validateSearch: validateRedirectSearch, component: LogoutPage});
