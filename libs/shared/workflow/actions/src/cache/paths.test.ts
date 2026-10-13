import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CacheArgumentError} from '#cache/errors.js';
import {expandAnchoredPaths, parseAnchoredPaths} from '#cache/paths.js';

describe('parseAnchoredPaths', () => {
  it('anchors by how the line is written', () => {
    expect(
      parseAnchoredPaths(['node_modules', '~/.npm', '/opt/tools', './dist/', '  ~/x  ']),
    ).toEqual([
      {anchor: 'cwd', pattern: 'node_modules'},
      {anchor: 'home', pattern: '.npm'},
      {anchor: 'root', pattern: 'opt/tools'},
      {anchor: 'cwd', pattern: 'dist'},
      {anchor: 'home', pattern: 'x'},
    ]);
  });

  it('normalizes a relative path that stays inside the working directory', () => {
    expect(parseAnchoredPaths(['a/../b'])).toEqual([{anchor: 'cwd', pattern: 'b'}]);
  });

  it.each([
    ['../outside'],
    ['a/../../outside'],
    ['..'],
    ['~/../other'],
  ])('rejects %s, which leaves its anchor', (path) => {
    expect(() => parseAnchoredPaths([path])).toThrow(CacheArgumentError);
  });

  it.each([[[]], [['']], [['   ']], [['~']], [['/']]])('rejects %j', (paths) => {
    expect(() => parseAnchoredPaths(paths as string[])).toThrow(CacheArgumentError);
  });
});

describe('expandAnchoredPaths', () => {
  let root: string;
  const directories = () => ({cwd: join(root, 'work'), home: join(root, 'home'), root: '/'});

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-cache-paths-'));
    await mkdir(join(root, 'work/node_modules/pkg'), {recursive: true});
    await mkdir(join(root, 'home/.npm'), {recursive: true});
    await writeFile(join(root, 'work/node_modules/pkg/index.js'), '');
    await writeFile(join(root, 'work/a.log'), '');
    await writeFile(join(root, 'work/b.log'), '');
    await writeFile(join(root, 'home/.npm/entry'), '');
    await symlink('missing-target', join(root, 'work/dangling'));
  });

  afterEach(async () => {
    await rm(root, {recursive: true, force: true});
  });

  it('keeps members relative to their anchor and sorted', async () => {
    const parsed = parseAnchoredPaths(['*.log', 'node_modules', '~/.npm']);

    const members = await expandAnchoredPaths(parsed, directories(), {pruneCovered: true});

    expect(Object.fromEntries(members)).toEqual({
      cwd: ['a.log', 'b.log', 'node_modules'],
      home: ['.npm'],
    });
  });

  it('drops a member inside another matched directory when pruning', async () => {
    const parsed = parseAnchoredPaths(['node_modules', 'node_modules/pkg/index.js']);

    const pruned = await expandAnchoredPaths(parsed, directories(), {pruneCovered: true});
    const all = await expandAnchoredPaths(parsed, directories(), {pruneCovered: false});

    expect(pruned.get('cwd')).toEqual(['node_modules']);
    expect(all.get('cwd')).toEqual(['node_modules', 'node_modules/pkg/index.js']);
  });

  it('reads extglob openers as patterns', async () => {
    const parsed = parseAnchoredPaths(['+(a|b).log', '!(a).log']);

    const members = await expandAnchoredPaths(parsed, directories(), {pruneCovered: true});

    expect(members.get('cwd')).toEqual(['a.log', 'b.log']);
  });

  it('keeps a backslash in a matched name', async () => {
    await writeFile(join(root, 'work/with\\slash.tmp'), '');

    const members = await expandAnchoredPaths(parseAnchoredPaths(['with*.tmp']), directories(), {
      pruneCovered: true,
    });

    expect(members.get('cwd')).toEqual(['with\\slash.tmp']);
  });

  it('rejects a matched name with a line break, which would split the member list', async () => {
    await writeFile(join(root, 'work/x\ny.tmp'), '');

    await expect(
      expandAnchoredPaths(parseAnchoredPaths(['x*.tmp']), directories(), {pruneCovered: true}),
    ).rejects.toThrow(CacheArgumentError);
  });

  it('matches nothing for a missing path and keeps a dangling symlink', async () => {
    const parsed = parseAnchoredPaths(['missing', 'dangling', '*.nothing']);

    const members = await expandAnchoredPaths(parsed, directories(), {pruneCovered: true});

    expect(Object.fromEntries(members)).toEqual({cwd: ['dangling']});
  });
});
