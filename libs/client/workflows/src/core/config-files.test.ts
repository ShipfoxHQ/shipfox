import type {ConfigFileEntry} from '@shipfox/client-projects';
import {
  buildConfigTree,
  type ConfigTreeNode,
  commitSubject,
  configAncestorPaths,
  configEntryProblem,
  configFileLanguage,
  configReadProblem,
  normalizeConfigPath,
  resolveConfigSelection,
} from './config-files.js';

const FILES: ConfigFileEntry[] = [
  {path: '.shipfox/workflows/review.yml', type: 'file', size: 10},
  {path: '.shipfox/README.md', type: 'file', size: 10},
  {path: '.shipfox/workflows/implement.yml', type: 'file', size: 10},
  {path: '.shipfox/actions/greet/action.yml', type: 'file', size: 10},
  {path: '.shipfox/prompts/shared.md', type: 'symlink', size: 9},
];

function shape(node: ConfigTreeNode): unknown {
  return node.kind === 'folder' ? {[node.name]: node.children.map(shape)} : node.name;
}

describe('buildConfigTree', () => {
  test('nests files under .shipfox, folders first, then by name', () => {
    const tree = buildConfigTree(FILES);

    expect(shape(tree)).toEqual({
      '.shipfox': [
        {actions: [{greet: ['action.yml']}]},
        {prompts: ['shared.md']},
        {workflows: ['implement.yml', 'review.yml']},
        'README.md',
      ],
    });
  });

  test('keeps paths and entries on each node', () => {
    const tree = buildConfigTree(FILES);

    const prompts = tree.children.find((node) => node.name === 'prompts');
    expect(prompts).toMatchObject({kind: 'folder', path: '.shipfox/prompts'});
    expect(prompts?.kind === 'folder' && prompts.children[0]).toMatchObject({
      kind: 'file',
      path: '.shipfox/prompts/shared.md',
      entry: {type: 'symlink'},
    });
  });

  test('ignores paths outside .shipfox', () => {
    const tree = buildConfigTree([{path: 'README.md', type: 'file', size: 1}]);

    expect(tree.children).toEqual([]);
  });
});

describe('configAncestorPaths', () => {
  test('lists the folders above a path from the root down', () => {
    const paths = configAncestorPaths('.shipfox/actions/greet/action.yml');

    expect(paths).toEqual(['.shipfox', '.shipfox/actions', '.shipfox/actions/greet']);
  });

  test('has nothing above the root', () => {
    expect(configAncestorPaths('.shipfox')).toEqual([]);
  });
});

describe('normalizeConfigPath', () => {
  test.each([
    {input: undefined, expected: null},
    {input: '', expected: null},
    {input: '.shipfox', expected: '.shipfox'},
    {input: '.shipfox/', expected: '.shipfox'},
    {input: '.shipfox/workflows/', expected: '.shipfox/workflows'},
    {input: '.shipfoxes/a.yml', expected: null},
    {input: 'src/index.ts', expected: null},
  ])('reads $input as $expected', ({input, expected}) => {
    expect(normalizeConfigPath(input)).toBe(expected);
  });
});

describe('resolveConfigSelection', () => {
  test.each([
    {path: null, kind: 'none'},
    {path: '.shipfox', kind: 'folder'},
    {path: '.shipfox/actions/greet', kind: 'folder'},
    {path: '.shipfox/workflows/review.yml', kind: 'file'},
    {path: '.shipfox/workflows/gone.yml', kind: 'missing'},
    {path: '.shipfox/work', kind: 'missing'},
  ])('selects $path as a $kind', ({path, kind}) => {
    expect(resolveConfigSelection(path, FILES).kind).toBe(kind);
  });
});

describe('file problems', () => {
  test('reads neither symbolic links nor submodules', () => {
    expect(configEntryProblem({path: 'a', type: 'symlink', size: 1})).toBe('symlink');
    expect(configEntryProblem({path: 'a', type: 'submodule', size: 0})).toBe('submodule');
    expect(configEntryProblem({path: 'a', type: 'file', size: 1})).toBeNull();
  });

  test.each([
    {code: 'content-too-large', problem: 'too-large'},
    {code: 'file-too-large', problem: 'too-large'},
    {code: 'binary-file-unsupported', problem: 'not-text'},
    {code: 'file-not-found', problem: 'not-found'},
    {code: 'provider-unavailable', problem: 'read-failed'},
    {code: undefined, problem: 'read-failed'},
  ])('maps a $code read failure to $problem', ({code, problem}) => {
    expect(configReadProblem(code)).toBe(problem);
  });
});

describe('configFileLanguage', () => {
  test.each([
    {path: '.shipfox/workflows/a.yml', language: 'yaml'},
    {path: '.shipfox/agents/a.YAML', language: 'yaml'},
    {path: '.shipfox/prompts/a.md', language: 'markdown'},
    {path: '.shipfox/actions/a/index.ts', language: 'typescript'},
    {path: '.shipfox/actions/a/.env', language: null},
    {path: '.shipfox/actions/a/Makefile', language: null},
  ])('highlights $path as $language', ({path, language}) => {
    expect(configFileLanguage(path)).toBe(language);
  });
});

describe('commitSubject', () => {
  test('keeps the first line of the message', () => {
    expect(commitSubject('Pin the checkout action\n\nThe tag moved.')).toBe(
      'Pin the checkout action',
    );
  });
});
