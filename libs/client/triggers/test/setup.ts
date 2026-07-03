import {installClientDomTestEnv} from '@shipfox/client-test-setup';
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
        (path, [key, value]) => path.split(`$${key}`).join(value),
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
