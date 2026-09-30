import {validateStoreKey} from '#core/store.js';

export interface StoreSettingsSearch {
  create?: string | undefined;
}

// The `create` key comes from links in error messages and can be hand-edited; an invalid one is
// dropped rather than thrown, since the create form would only open on a name it rejects.
export function validateStoreSettingsSearch(search: Record<string, unknown>): StoreSettingsSearch {
  const {create} = search;
  return typeof create === 'string' && validateStoreKey(create) === undefined ? {create} : {};
}
