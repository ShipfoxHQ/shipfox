import '@testing-library/jest-dom/vitest';

// Pure-logic tests run in the node environment (the package default), where
// there is no window; the browser stubs only apply to jsdom test files
// (those carrying the `@vitest-environment jsdom` pragma).
if (typeof window !== 'undefined') {
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
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
}
