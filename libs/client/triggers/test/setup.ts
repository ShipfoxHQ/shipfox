import {installClientDomTestEnv} from '@shipfox/client-test-setup';
import {configure} from '@testing-library/react';

installClientDomTestEnv();

// The jsdom `dom` project shares a `vitest run` with the CPU-heavy `storybook (chromium)`
// browser project, so a `findBy*`/`waitFor` can starve well past Testing Library's 1s
// default while the browser tests saturate the host. Widen the ceiling: a resolved query
// still returns immediately, so this only buys headroom for a contended cold start.
configure({asyncUtilTimeout: 5000});
