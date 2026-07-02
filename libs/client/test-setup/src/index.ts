import '@testing-library/jest-dom/vitest';
import {resetApiClient} from '@shipfox/client-api';
import {afterEach} from '@shipfox/vitest/vi';
import {cleanup} from '@testing-library/react';

/**
 * Installs the shared jsdom environment for a client package's `dom` test
 * project. Call it once from the package's `test/setup.ts`.
 *
 * It registers per-test teardown that keeps files isolation-safe, so a package
 * can run its dom project with `isolate: false` (module state and the jsdom
 * document are then shared across files in a worker):
 * - `cleanup()` unmounts any React tree a test rendered, so the shared
 *   `document.body` does not accumulate nodes across files.
 * - `resetApiClient()` clears `@shipfox/client-api` config, so a test that calls
 *   `configureApiClient` cannot leak its base URL, auth, or fetch override into
 *   the next file.
 *
 * It also stubs the browser APIs jsdom omits but our components touch on render
 * (`ResizeObserver`, `matchMedia`, `scrollTo`, `scrollIntoView`).
 */
export function installClientDomTestEnv(): void {
  afterEach(() => {
    cleanup();
    resetApiClient();
  });

  installBrowserStubs();
}

function installBrowserStubs(): void {
  // A package's node project may share this setup file; the window stubs are a
  // no-op there and only apply to jsdom test files.
  if (typeof window === 'undefined') return;

  class ResizeObserverStub {
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  }

  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: ResizeObserverStub,
  });

  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    value: () => undefined,
  });

  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: query.includes('min-width'),
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
}
