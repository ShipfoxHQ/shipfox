import {useEffect, useState} from 'react';

/** True once `delayMs` has passed since `since`. It re-renders once, when the time comes. */
export function useElapsed(since: number | undefined, delayMs: number): boolean {
  const [reached, setReached] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (since === undefined) return;
    const remaining = since + delayMs - Date.now();
    if (remaining <= 0) {
      setReached(since);
      return;
    }
    const timer = setTimeout(() => setReached(since), remaining);
    return () => clearTimeout(timer);
  }, [since, delayMs]);

  return since !== undefined && reached === since;
}

/** When `active` last became true, or undefined while it is false. */
export function useSince(active: boolean): number | undefined {
  const [since, setSince] = useState<number | undefined>(() => (active ? Date.now() : undefined));

  useEffect(() => {
    setSince((current) => {
      if (!active) return undefined;
      return current ?? Date.now();
    });
  }, [active]);

  return active ? since : undefined;
}
