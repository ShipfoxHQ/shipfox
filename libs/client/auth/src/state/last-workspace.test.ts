import {createStore} from 'jotai';
import {
  getLastWorkspaceId,
  lastWorkspaceIdAtom,
  rememberLastWorkspaceId,
} from './last-workspace.js';

describe('lastWorkspaceIdAtom', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  test('initial value is undefined when storage is empty', () => {
    const store = createStore();

    expect(store.get(lastWorkspaceIdAtom)).toBeUndefined();
  });

  test('write persists to localStorage and round-trips through the atom', () => {
    const store = createStore();

    store.set(lastWorkspaceIdAtom, 'workspace-1');

    expect(JSON.parse(window.localStorage.getItem('shipfox.lastWorkspaceId') ?? 'null')).toBe(
      'workspace-1',
    );
    expect(store.get(lastWorkspaceIdAtom)).toBe('workspace-1');
  });

  test('subscribers receive updates when the atom is set', () => {
    const store = createStore();
    const seen: Array<string | undefined> = [];
    const unsubscribe = store.sub(lastWorkspaceIdAtom, () => {
      seen.push(store.get(lastWorkspaceIdAtom));
    });

    store.set(lastWorkspaceIdAtom, 'workspace-1');
    store.set(lastWorkspaceIdAtom, 'workspace-2');

    expect(seen).toEqual(['workspace-1', 'workspace-2']);
    unsubscribe();
  });

  test('rememberLastWorkspaceId persists a root redirect target', () => {
    rememberLastWorkspaceId('workspace-1');

    const result = getLastWorkspaceId();

    expect(result).toBe('workspace-1');
  });

  test('getLastWorkspaceId ignores malformed storage', () => {
    window.localStorage.setItem('shipfox.lastWorkspaceId', '{');

    const result = getLastWorkspaceId();

    expect(result).toBeUndefined();
  });
});
