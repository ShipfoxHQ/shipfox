import {createStore} from 'jotai';
import {
  getLastWorkspaceId,
  lastWorkspaceIdAtom,
  rememberLastWorkspaceId,
} from './last-workspace.js';

describe('last workspace state', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  test('atom stores current UI selection without unscoped persistence', () => {
    const store = createStore();

    store.set(lastWorkspaceIdAtom, 'workspace-1');

    expect(store.get(lastWorkspaceIdAtom)).toBe('workspace-1');
    expect(window.localStorage.getItem('shipfox.lastWorkspaceId')).toBeNull();
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

  test('write persists to localStorage and can be read for the same principal', () => {
    rememberLastWorkspaceId('principal-1', 'workspace-1');

    expect(
      JSON.parse(
        window.localStorage.getItem('shipfox.lastWorkspaceId.principal.principal-1') ?? 'null',
      ),
    ).toBe('workspace-1');
    expect(getLastWorkspaceId('principal-1')).toBe('workspace-1');
  });

  test('rememberLastWorkspaceId persists a root redirect target', () => {
    rememberLastWorkspaceId('principal-1', 'workspace-1');

    const result = getLastWorkspaceId('principal-1');

    expect(result).toBe('workspace-1');
  });

  test("does not reuse a different principal's root redirect target", () => {
    rememberLastWorkspaceId('principal-a', 'workspace-a');

    expect(getLastWorkspaceId('principal-b')).toBeUndefined();
  });

  test('getLastWorkspaceId ignores malformed storage', () => {
    window.localStorage.setItem('shipfox.lastWorkspaceId.principal.principal-1', '{');

    const result = getLastWorkspaceId('principal-1');

    expect(result).toBeUndefined();
  });
});
