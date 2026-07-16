import type {Decorator} from '@storybook/react';
import {QueryClient} from '@tanstack/react-query';
import {createStore} from 'jotai';
import {type PropsWithChildren, useState} from 'react';
import type {ClientFeature} from '#contract.js';
import {ShellProviderStack} from '../runtime/provider-stack.js';

export function ShellProviders({
  features = [],
  children,
}: PropsWithChildren<{features?: readonly ClientFeature[]}>) {
  const [queryClient] = useState(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
  );
  const [store] = useState(createStore);
  return (
    <ShellProviderStack features={features} queryClient={queryClient} store={store}>
      {children}
    </ShellProviderStack>
  );
}

export const shellDecorator: Decorator = (Story) => (
  <ShellProviders>
    <Story />
  </ShellProviders>
);
