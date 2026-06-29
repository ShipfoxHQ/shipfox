import '@testing-library/jest-dom/vitest';

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
