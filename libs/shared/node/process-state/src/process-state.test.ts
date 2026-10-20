import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {duplicatePackageCopies, processState} from './index.js';

function installedUrl(params: {variant: string; packageName: string; file: string}): string {
  const {variant, packageName, file} = params;
  const store = `/app/node_modules/.pnpm/${packageName.replace('/', '+')}@1.0.0_${variant}`;
  return pathToFileURL(`${store}/node_modules/${packageName}/dist/${file}`).href;
}

function resetGlobals(): void {
  const store = globalThis as unknown as Record<symbol, unknown>;
  store[Symbol.for('@shipfox/node-process-state/registry/v1')] = undefined;
  for (const key of ['test/a/v1', 'test/b/v1', 'test/a/v2']) delete store[Symbol.for(key)];
}

describe('processState', () => {
  beforeEach(resetGlobals);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shares one value between callers of the same key', () => {
    const first = processState('test/a/v1', () => ({count: 1}), 'file:///app/src/a.js');
    const init = vi.fn(() => ({count: 2}));

    const second = processState('test/a/v1', init, 'file:///other/src/a.js');

    expect(second).toBe(first);
    expect(init).not.toHaveBeenCalled();
  });

  it('keeps keys with different versions apart', () => {
    const v1 = processState('test/a/v1', () => ({shape: 1}), 'file:///app/src/a.js');
    const v2 = processState('test/a/v2', () => ({shape: 2}), 'file:///app/src/a.js');

    expect(v2).not.toBe(v1);
  });
});

describe('duplicatePackageCopies', () => {
  beforeEach(resetGlobals);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports nothing for one copy with state in two files', () => {
    const packageName = '@shipfox/pkg';
    processState('test/a/v1', () => ({}), installedUrl({variant: 'x', packageName, file: 'a.js'}));
    processState('test/b/v1', () => ({}), installedUrl({variant: 'x', packageName, file: 'b.js'}));

    expect(duplicatePackageCopies()).toEqual([]);
  });

  it('reports copies with the same keys as sharing state', () => {
    const packageName = '@shipfox/pkg';
    for (const variant of ['x', 'y']) {
      processState('test/a/v1', () => ({}), installedUrl({variant, packageName, file: 'a.js'}));
      processState('test/b/v1', () => ({}), installedUrl({variant, packageName, file: 'b.js'}));
    }

    const [duplicate] = duplicatePackageCopies();

    expect(duplicatePackageCopies()).toHaveLength(1);
    expect(duplicate?.packageName).toBe(packageName);
    expect(duplicate?.sharesState).toBe(true);
    expect(duplicate?.copies.map((copy) => copy.installFolder)).toEqual([
      '/app/node_modules/.pnpm/@shipfox+pkg@1.0.0_x/node_modules/@shipfox/pkg',
      '/app/node_modules/.pnpm/@shipfox+pkg@1.0.0_y/node_modules/@shipfox/pkg',
    ]);
    expect(duplicate?.copies[0]?.slotKeys).toEqual(['test/a/v1', 'test/b/v1']);
  });

  it('reports copies with different key versions as not sharing state', () => {
    const packageName = 'plain-pkg';
    processState('test/a/v1', () => ({}), installedUrl({variant: 'x', packageName, file: 'a.js'}));
    processState('test/a/v2', () => ({}), installedUrl({variant: 'y', packageName, file: 'a.js'}));

    const [duplicate] = duplicatePackageCopies();

    expect(duplicate?.packageName).toBe(packageName);
    expect(duplicate?.sharesState).toBe(false);
  });

  it('warns when a copy registers after the report', () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    const packageName = '@shipfox/pkg';
    processState('test/a/v1', () => ({}), installedUrl({variant: 'x', packageName, file: 'a.js'}));
    duplicatePackageCopies();
    expect(warn).not.toHaveBeenCalled();

    processState('test/a/v1', () => ({}), installedUrl({variant: 'y', packageName, file: 'a.js'}));

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('@shipfox/pkg');
    expect(warn.mock.calls[0]?.[0]).toContain('_y/node_modules/@shipfox/pkg');
  });

  it('does not warn for a late file of an already registered copy', () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    const packageName = '@shipfox/pkg';
    processState('test/a/v1', () => ({}), installedUrl({variant: 'x', packageName, file: 'a.js'}));
    duplicatePackageCopies();

    processState('test/b/v1', () => ({}), installedUrl({variant: 'x', packageName, file: 'b.js'}));

    expect(warn).not.toHaveBeenCalled();
  });

  describe('workspace links', () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'process-state-'));
      mkdirSync(join(root, 'libs/pkg/src/nested'), {recursive: true});
      writeFileSync(join(root, 'libs/pkg/package.json'), JSON.stringify({name: '@shipfox/linked'}));
      writeFileSync(join(root, 'libs/pkg/src/nested/package.json'), '{"type":"module"}');
    });

    afterEach(() => {
      rmSync(root, {recursive: true, force: true});
    });

    it('attributes files to the folder of the nearest package.json', () => {
      processState('test/a/v1', () => ({}), pathToFileURL(join(root, 'libs/pkg/src/a.ts')).href);
      processState(
        'test/b/v1',
        () => ({}),
        pathToFileURL(join(root, 'libs/pkg/src/nested/b.ts')).href,
      );
      processState(
        'test/a/v1',
        () => ({}),
        installedUrl({variant: 'x', packageName: '@shipfox/linked', file: 'a.js'}),
      );

      const [duplicate] = duplicatePackageCopies();

      expect(duplicate?.packageName).toBe('@shipfox/linked');
      expect(duplicate?.copies.map((copy) => copy.installFolder)).toContain(join(root, 'libs/pkg'));
      expect(duplicate?.copies).toHaveLength(2);
    });
  });
});
