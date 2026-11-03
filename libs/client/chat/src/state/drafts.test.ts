import {createDraftStore, draftKey} from './drafts.js';

function createStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
}

describe('createDraftStore', () => {
  beforeEach(() => vi.stubGlobal('window', {sessionStorage: createStorage()}));
  afterEach(() => vi.unstubAllGlobals());

  test('keeps a draft per conversation and per user', () => {
    const mine = createDraftStore('user-1');
    mine.write(draftKey('project', 'conversation'), 'Why did');
    mine.write(draftKey('project', undefined), 'New question');

    expect(mine.read(draftKey('project', 'conversation'))).toBe('Why did');
    expect(mine.read(draftKey('project', undefined))).toBe('New question');
    expect(createDraftStore('user-2').read(draftKey('project', 'conversation'))).toBe('');
  });

  test('forgets an emptied draft, and stores nothing without a user', () => {
    const store = createDraftStore('user-1');
    store.write('key', 'text');
    store.write('key', '');

    expect(store.read('key')).toBe('');
    createDraftStore(undefined).write('key', 'text');
    expect(createDraftStore(undefined).read('key')).toBe('');
  });
});
