import {type QueryClient, useQueryClient} from '@tanstack/react-query';
import type {PropsWithChildren} from 'react';

export const providerProbe: {
  order: string[];
  queryClients: QueryClient[];
} = {
  order: [],
  queryClients: [],
};

export function resetProviderProbe(): void {
  providerProbe.order.length = 0;
  providerProbe.queryClients.length = 0;
}

export function recordProvider(id: string, queryClient: QueryClient): void {
  providerProbe.order.push(id);
  providerProbe.queryClients.push(queryClient);
}

export function ToyFeatureProvider({children}: PropsWithChildren) {
  recordProvider('toy-feature', useQueryClient());
  return children;
}
