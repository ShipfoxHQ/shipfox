import {installClientDomTestEnv} from '@shipfox/client-test-setup';
import {type AnchorHTMLAttributes, createElement, type ReactNode} from 'react';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      search,
      children,
      ...props
    }: AnchorHTMLAttributes<HTMLAnchorElement> & {
      to: string;
      params?: Record<string, string> | undefined;
      search?: Record<string, string | undefined> | undefined;
      children: ReactNode;
    }) => {
      const path = Object.entries(params ?? {}).reduce(
        (acc, [key, value]) => acc.split(`$${key}`).join(value),
        to,
      );
      const query = new URLSearchParams(
        Object.entries(search ?? {}).filter((entry): entry is [string, string] => entry[1] != null),
      ).toString();
      return createElement(
        'a',
        {href: query === '' ? path : `${path}?${query}`, ...props},
        children,
      );
    },
  };
});

vi.mock('#hooks/api/trigger-events.js', () => ({
  useTriggerEventFacetsQuery: vi.fn(),
  useTriggerEventQuery: vi.fn(),
  useTriggerEventsInfiniteQuery: vi.fn(),
}));

installClientDomTestEnv();
