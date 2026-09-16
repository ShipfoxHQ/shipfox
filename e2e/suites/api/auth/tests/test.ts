import {type AuthFixtures, authHelper} from '@shipfox/e2e-setup-auth';
import {test as base, expect} from '@shipfox/playwright';

export const test = base.extend<AuthFixtures>(authHelper);
export {expect};
