import {getLoadedConfig} from '@shipfox/client-config';
import {type QueryClient, useQueryClient} from '@tanstack/react-query';
import {type createStore, useStore} from 'jotai';
import {createContext, createElement, type PropsWithChildren, useContext} from 'react';

type Store = ReturnType<typeof createStore>;

export interface ProviderEvidence {
  id: string;
  queryClient: QueryClient;
  store: Store;
  externalGreeting: string;
}

const ProviderOrderContext = createContext<readonly string[]>([]);
const providerEvidence = new Map<string, ProviderEvidence>();

function ExternalProvider({id, children}: PropsWithChildren<{id: string}>) {
  const parentOrder = useContext(ProviderOrderContext);
  const queryClient = useQueryClient();
  const store = useStore();
  const {externalGreeting} = getLoadedConfig<{externalGreeting: string}>();
  providerEvidence.set(id, {id, queryClient, store, externalGreeting});
  return createElement(ProviderOrderContext.Provider, {value: [...parentOrder, id]}, children);
}

export function ExternalProviderOuter({children}: PropsWithChildren) {
  return createElement(ExternalProvider, {id: 'outer'}, children);
}

export function ExternalProviderInner({children}: PropsWithChildren) {
  return createElement(ExternalProvider, {id: 'inner'}, children);
}

export function useProviderOrder(): readonly string[] {
  return useContext(ProviderOrderContext);
}

export function readProviderEvidence(): readonly ProviderEvidence[] {
  return [...providerEvidence.values()];
}

export function resetProviderEvidence(): void {
  providerEvidence.clear();
}
