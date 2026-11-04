import type {TypedBrowserStorage} from '@shipfox/client-ui';
import {atom} from 'jotai';

/** An atom backed by browser storage. A written value wins over the stored one until reload. */
export function persistedAtom<T>(
  storage: TypedBrowserStorage<T>,
  fallback: T,
  canRestore: () => boolean = () => true,
) {
  const writtenAtom = atom<T | undefined>(undefined);
  return atom(
    (get) => get(writtenAtom) ?? (canRestore() ? storage.read() : undefined) ?? fallback,
    (_get, set, value: T) => {
      storage.write(value);
      set(writtenAtom, value);
    },
  );
}
