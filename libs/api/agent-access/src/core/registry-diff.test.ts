import {
  changedSourceFiles,
  diffDeclarations,
  pageSourceDiff,
  sourceFilePatch,
} from './registry-diff.js';

const UNPAIRED_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])/;

describe('diffDeclarations', () => {
  test('reports added, removed, and changed entries', () => {
    expect(
      diffDeclarations(
        {kept: {type: 'string'}, removed: {type: 'string'}, changed: {type: 'string'}},
        {kept: {type: 'string'}, added: {type: 'number'}, changed: {type: 'number'}},
      ),
    ).toEqual({
      added: {added: {type: 'number'}},
      removed: {removed: {type: 'string'}},
      changed: {changed: {from: {type: 'string'}, to: {type: 'number'}}},
    });
  });

  test('keeps author-chosen names such as __proto__ as data', () => {
    const added = JSON.parse('{"__proto__": {"type": "string"}}');

    const changes = diffDeclarations({}, added);

    expect(Object.keys(changes.added)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(changes.added)).toBe(Object.prototype);
  });
});

describe('changedSourceFiles', () => {
  test('lists new, removed, and edited files by path and skips identical ones', () => {
    const changes = changedSourceFiles(
      [
        {path: 'b.txt', content: 'same'},
        {path: 'gone.txt', content: 'old'},
        {path: 'edit.txt', content: 'one'},
      ],
      [
        {path: 'new.txt', content: 'fresh'},
        {path: 'b.txt', content: 'same'},
        {path: 'edit.txt', content: 'two'},
      ],
    );

    expect(changes).toEqual([
      {path: 'edit.txt', before: 'one', after: 'two'},
      {path: 'gone.txt', before: 'old', after: undefined},
      {path: 'new.txt', before: undefined, after: 'fresh'},
    ]);
  });
});

describe('sourceFilePatch', () => {
  test('writes a unified diff for an edit', () => {
    const patch = sourceFilePatch({path: 'a.txt', before: 'one\ntwo\n', after: 'one\nthree\n'});

    expect(patch).toContain('--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n');
  });

  test('replaces a file that changed too much to diff cheaply with one hunk', () => {
    const lines = (seed: string) => Array.from({length: 5000}, (_, index) => `${seed} ${index}`);

    const patch = sourceFilePatch({
      path: 'big.txt',
      before: `${lines('old').join('\n')}\n`,
      after: `${lines('new').join('\n')}\n`,
    });

    expect(patch.startsWith('--- a/big.txt\n+++ b/big.txt\n@@ -1,5000 +1,5000 @@\n-old 0\n')).toBe(
      true,
    );
    expect(patch).toContain('\n+new 4999\n');
  });
});

describe('pageSourceDiff', () => {
  const changes = ['a', 'b', 'c'].map((path) => ({
    path,
    before: undefined,
    after: 'x'.repeat(400),
  }));

  test('fills a page with whole files and points at the next one', () => {
    const page = pageSourceDiff({changes, start: 0, maxBytes: 1200});

    expect(page.text).toContain('+++ b/a');
    expect(page.text).toContain('+++ b/b');
    expect(page.text).not.toContain('+++ b/c');
    expect(page.next).toBe(2);
  });

  test('ends with a null cursor after the last file', () => {
    expect(pageSourceDiff({changes, start: 2, maxBytes: 1000}).next).toBeNull();
  });

  test('never splits a surrogate pair when it cuts a file', () => {
    const page = pageSourceDiff({
      changes: [{path: 'emoji.txt', before: undefined, after: '😀'.repeat(500)}],
      start: 0,
      maxBytes: 301,
    });

    expect(page.text).toContain('cut at the page limit');
    expect(page.text).not.toMatch(UNPAIRED_SURROGATE);
    expect(page.next).toBeNull();
  });
});
