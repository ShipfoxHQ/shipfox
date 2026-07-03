# @shipfox/client-test-setup

Shared jsdom setup for the `dom` Vitest project of client feature packages.

## What it does

`installClientDomTestEnv()` is the single entry point. Call it once from a
package's `test/setup.ts`:

```ts
import {installClientDomTestEnv} from '@shipfox/client-test-setup';

installClientDomTestEnv();
```

It:

- registers `afterEach` teardown that unmounts rendered React trees
  (`cleanup`) and resets `@shipfox/client-api` config (`resetApiClient`), so a
  package can run its `dom` project with `isolate: false` without one file
  leaking DOM nodes or API-client config into the next;
- stubs the browser APIs jsdom omits but components touch on render
  (`ResizeObserver`, `matchMedia`, `scrollTo`, `scrollIntoView`).

`matchMedia` reports `min-width` queries as matching (desktop) and everything
else as not matching.

A package that needs extra DOM test configuration adds it in its own
`test/setup.ts` after the call.
