import {useCallback, useLayoutEffect, useMemo, useRef, useState} from 'react';
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
  const {userId, projectId, conversationId} = params;
  const store = useMemo(() => createDraftStore(userId), [userId]);
  const key = draftKey(projectId, conversationId);
  const [value, setValueState] = useState(() => store.read(key));
  const valueRef = useRef(value);

  const setValue = useCallback((next: string) => {
    valueRef.current = next;
    setValueState(next);
  }, []);

  const save = useCallback(() => store.write(key, valueRef.current), [store, key]);

  // Each conversation and each user has its own draft. The one left behind keeps what it held.
  // A layout effect swaps it before paint, so the old text never shows in the new conversation.
  useLayoutEffect(() => {
    setValue(store.read(key));
    window.addEventListener('pagehide', save);
    return () => {
      window.removeEventListener('pagehide', save);
      save();
    };
  }, [store, key, save, setValue]);

  const take = useCallback(() => {
    const taken = valueRef.current;
    setValue('');
    store.write(key, '');
    return taken;
  }, [store, key, setValue]);

  const moveTo = useCallback(
    (target: string | undefined) => {
      store.write(draftKey(projectId, target), valueRef.current);
      setValue('');
    },
    [store, projectId, setValue],
  );

  return {value, setValue, save, take, moveTo};
}
