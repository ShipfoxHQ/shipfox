import '@testing-library/jest-dom/vitest';
import {configure} from '@testing-library/react';

// The jsdom `dom` project shares a `vitest run` with the CPU-heavy `storybook (chromium)`
// browser project, so a `findBy*`/`waitFor` can starve well past Testing Library's 1s
// default while the browser tests saturate the host. Widen the ceiling: a resolved query
// still returns immediately, so this only buys headroom for a contended cold start.
configure({asyncUtilTimeout: 5000});

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
