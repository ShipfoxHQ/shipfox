import '@testing-library/jest-dom/vitest';

// This setup file is shared by the node and jsdom vitest projects. The `.test.ts`
// files run in the node environment (no window), so the browser stubs below only
// apply to the jsdom project, which selects `.test.tsx` files via vitest.config.ts.
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
