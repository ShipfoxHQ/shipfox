import {atom, useAtomValue, useSetAtom} from 'jotai';
import {useCallback} from 'react';

/** Every attempt reports its failure, so a dock that keeps failing stops retrying. */
const MAX_DOCK_ATTEMPTS = 3;

interface DockFailure {
  attempts: number;
  failing: boolean;
}

// Kept above the host, which remounts per project: leaving a project and coming
// back must neither refill its attempts nor leave its launcher hidden.
const dockFailuresAtom = atom<Readonly<Record<string, DockFailure>>>({});

const recordDockFailureAtom = atom(null, (get, set, scope: string) => {
  const failures = get(dockFailuresAtom);
  const attempts = (failures[scope]?.attempts ?? 0) + 1;
  set(dockFailuresAtom, {...failures, [scope]: {attempts, failing: true}});
});

const clearDockFailingAtom = atom(null, (get, set, scope: string) => {
  const failures = get(dockFailuresAtom);
  const failure = failures[scope];
  if (failure?.failing) set(dockFailuresAtom, {...failures, [scope]: {...failure, failing: false}});
});

function isExhausted(failure: DockFailure | undefined): boolean {
  return (failure?.attempts ?? 0) >= MAX_DOCK_ATTEMPTS;
}

/** A failed dock has no panel to open, so the frame shows no launcher for it. */
export function useProjectDockAvailable(scope: string | undefined): boolean {
  const failure = useAtomValue(dockFailuresAtom)[scope ?? ''];
  return !failure?.failing && !isExhausted(failure);
}

export function useProjectDockFailures(scope: string) {
  const exhausted = isExhausted(useAtomValue(dockFailuresAtom)[scope]);
  const record = useSetAtom(recordDockFailureAtom);
  const clear = useSetAtom(clearDockFailingAtom);
  return {
    exhausted,
    recordFailure: useCallback(() => record(scope), [record, scope]),
    clearFailing: useCallback(() => clear(scope), [clear, scope]),
  };
}
