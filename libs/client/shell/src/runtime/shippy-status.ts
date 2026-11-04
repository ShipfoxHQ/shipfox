import {atom, useAtomValue, useSetAtom} from 'jotai';
import {useEffect} from 'react';

/**
 * What the project agent is doing, as Shippy shows it. `reply_ready` waves once, and `failed`
 * looks like `idle` without its tail flick, because Shippy never reacts to a failure.
 */
export type ShippyState = 'idle' | 'working' | 'reply_ready' | 'failed';

export interface ShippyStatus {
  state: ShippyState;
}

// One object per publication, so a late cleanup can tell its entry from a newer one.
const publishedStatusAtom = atom<{status: ShippyStatus} | undefined>(undefined);

/**
 * Publishes the dock's status to the launcher, until the caller unmounts. The dock calls this
 * once, because the shell keeps one value.
 */
export function useShippyStatus(status: ShippyStatus): void {
  const publish = useSetAtom(publishedStatusAtom);
  const {state} = status;
  useEffect(() => {
    const entry = {status: {state}};
    publish(entry);
    return () => publish((current) => (current === entry ? undefined : current));
  }, [publish, state]);
}

/** The status the dock published. `idle` when no dock publishes one. */
export function useCurrentShippyStatus(): ShippyStatus {
  return useAtomValue(publishedStatusAtom)?.status ?? IDLE;
}

const IDLE: ShippyStatus = {state: 'idle'};
