import {installClientDomTestEnv} from './index.js';

installClientDomTestEnv();

describe('installClientDomTestEnv', () => {
  test('stubs the browser APIs jsdom omits', () => {
    expect(typeof window.ResizeObserver).toBe('function');
    expect(typeof window.scrollTo).toBe('function');
    expect(typeof window.HTMLElement.prototype.scrollIntoView).toBe('function');
  });

  test('matchMedia matches min-width queries and rejects the rest', () => {
    expect(window.matchMedia('(min-width: 768px)').matches).toBe(true);
    expect(window.matchMedia('(max-width: 768px)').matches).toBe(false);
  });
});
