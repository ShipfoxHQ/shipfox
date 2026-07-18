import {setLoadedConfig} from '@shipfox/client-config';
import type {Decorator} from '@storybook/react';
import {QueryClient, type QueryClient as QueryClientInstance} from '@tanstack/react-query';
import {createStore} from 'jotai';
import {type PropsWithChildren, useState} from 'react';
import type {ClientFeature} from '#contract.js';
import {ShellProviderStack} from '../runtime/provider-stack.js';

type Store = ReturnType<typeof createStore>;

export interface ShellProvidersOptions {
  features?: readonly ClientFeature[];
  queryClient?: QueryClientInstance;
  store?: Store;
  config?: unknown;
}

export function ShellProviders({
  features = [],
  queryClient: providedQueryClient,
  store: providedStore,
  config,
  children,
}: PropsWithChildren<ShellProvidersOptions>) {
  const [defaultQueryClient] = useState(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
  );
  const [defaultStore] = useState(createStore);
  if (config !== undefined) setLoadedConfig(config);

  return (
    <ShellProviderStack
      features={features}
      queryClient={providedQueryClient ?? defaultQueryClient}
      store={providedStore ?? defaultStore}
      auth={{effects: false}}
    >
      {children}
    </ShellProviderStack>
  );
}

export function createShellDecorator(options: ShellProvidersOptions = {}): Decorator {
  return (Story) => (
    <ShellProviders {...options}>
      <Story />
    </ShellProviders>
  );
}

export const shellDecorator = createShellDecorator();
