import {installClientDomTestEnv} from '@shipfox/client-test-setup';
import {configure} from '@testing-library/react';
import {type AnchorHTMLAttributes, createElement, type ReactNode} from 'react';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      search: _search,
      children,
      ...props
    }: AnchorHTMLAttributes<HTMLAnchorElement> & {
      to: string;
      params?: Record<string, string> | undefined;
      search?: unknown;
      children: ReactNode;
    }) => {
      const href = Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      );
      return createElement('a', {href, ...props}, children);
    },
  };
});

vi.mock('#hooks/api/trigger-events.js', () => ({
  useTriggerEventFacetsQuery: vi.fn(),
  useTriggerEventQuery: vi.fn(),
  useTriggerEventsInfiniteQuery: vi.fn(),
}));

installClientDomTestEnv();

// The jsdom `dom` project shares a `vitest run` with the CPU-heavy `storybook (chromium)`
// browser project, so a `findBy*`/`waitFor` can starve well past Testing Library's 1s
// default while the browser tests saturate the host. Widen the ceiling: a resolved query
// still returns immediately, so this only buys headroom for a contended cold start.
configure({asyncUtilTimeout: 5000});
