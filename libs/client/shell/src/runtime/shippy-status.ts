import {atom, useAtomValue, useSetAtom} from 'jotai';
import {useEffect} from 'react';

/**
 * What the project agent is doing, as Shippy shows it. `reply_ready` waves once, and `failed`
 * looks like `idle` without its tail flick, because Shippy never reacts to a failure.
 */
export type ShippyState = 'idle' | 'working' | 'reply_ready' | 'failed';

export interface ShippyStatus {
  state: ShippyState;
  /** Conversations with a reply the user hasn't seen. Shippy shows the count as a badge. */
  unread: number;
}

// One object per publication, so a late cleanup can tell its entry from a newer one.
const publishedStatusAtom = atom<{status: ShippyStatus} | undefined>(undefined);

/**
 * Publishes the dock's status to the launcher, until the caller unmounts. The dock calls this
 * once, because the shell keeps one value.
 */
export function useShippyStatus(status: {state: ShippyState; unread?: number | undefined}): void {
  const publish = useSetAtom(publishedStatusAtom);
  const {state, unread = 0} = status;
  useEffect(() => {
    const entry = {status: {state, unread}};
    publish(entry);
    return () => publish((current) => (current === entry ? undefined : current));
  }, [publish, state, unread]);
}

/** The status the dock published. `idle` with nothing unread when no dock publishes one. */
export function useCurrentShippyStatus(): ShippyStatus {
  return useAtomValue(publishedStatusAtom)?.status ?? IDLE;
}

const IDLE: ShippyStatus = {state: 'idle', unread: 0};
