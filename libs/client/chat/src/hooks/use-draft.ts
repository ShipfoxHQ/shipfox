import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createDraftStore, draftKey} from '#state/drafts.js';

export interface Draft {
  value: string;
  setValue: (value: string) => void;
  /** Persists the draft. Called on blur, so typing never writes storage. */
  save: () => void;
  /** Empties the draft, and returns what it held. */
  take: () => string;
  /** Moves the draft to another conversation, as when this one was deleted. */
  moveTo: (conversationId: string | undefined) => void;
}

/**
 * The composer's text for one conversation. It survives navigation, because the dock stays
 * mounted, and a reload, because it is saved on blur, on unmount, and when the page hides.
 */
export function useDraft(params: {
  userId: string | undefined;
  projectId: string;
  conversationId: string | undefined;
}): Draft {
  const store = useMemo(() => createDraftStore(params.userId), [params.userId]);
  const key = draftKey(params.projectId, params.conversationId);
  const [state, setState] = useState(() => ({key, value: store.read(key)}));
  const latest = useRef(state);
  latest.current = state;

  // Another conversation opens with its own draft. The one left behind keeps what it held.
  if (state.key !== key) {
    store.write(state.key, state.value);
    const next = {key, value: store.read(key)};
    latest.current = next;
    setState(next);
  }

  const save = useCallback(() => store.write(latest.current.key, latest.current.value), [store]);

  useEffect(() => {
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [save]);

  const setValue = useCallback((value: string) => {
    setState((current) => ({...current, value}));
  }, []);

  const take = useCallback(() => {
    const {key: current, value} = latest.current;
    store.write(current, '');
    latest.current = {key: current, value: ''};
    setState(latest.current);
    return value;
  }, [store]);

  const moveTo = useCallback(
    (conversationId: string | undefined) => {
      const {key: from, value} = latest.current;
      store.write(from, '');
      store.write(draftKey(params.projectId, conversationId), value);
    },
    [store, params.projectId],
  );

  return {
    value: state.key === key ? state.value : latest.current.value,
    setValue,
    save,
    take,
    moveTo,
  };
}
