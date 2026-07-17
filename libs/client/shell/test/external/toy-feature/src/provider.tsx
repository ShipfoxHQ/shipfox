import {type QueryClient, useQueryClient} from '@tanstack/react-query';
import {createContext, type PropsWithChildren, useContext, useEffect, useMemo} from 'react';

export interface ProviderProbeEntry {
  id: string;
  queryClient: QueryClient;
}

const ProviderProbeContext = createContext<readonly ProviderProbeEntry[]>([]);

export function ProviderProbe({id, children}: PropsWithChildren<{id: string}>) {
  const parentEntries = useContext(ProviderProbeContext);
  const queryClient = useQueryClient();
  const entries = useMemo(
    () => [...parentEntries, {id, queryClient}],
    [id, parentEntries, queryClient],
  );
  return <ProviderProbeContext value={entries}>{children}</ProviderProbeContext>;
}

export function ProviderProbeObserver({
  onChange,
}: {
  onChange: (entries: readonly ProviderProbeEntry[]) => void;
}) {
  const entries = useContext(ProviderProbeContext);
  useEffect(() => onChange(entries), [entries, onChange]);
  return null;
}

export function ToyFeatureProvider({children}: PropsWithChildren) {
  return <ProviderProbe id="toy-feature">{children}</ProviderProbe>;
}
