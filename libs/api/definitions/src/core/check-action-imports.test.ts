import {checkActionImports} from './check-action-imports.js';

describe('checkActionImports', () => {
  it('accepts TypeScript and JavaScript imports that resolve inside the action', async () => {
    const files = [
      {
        path: 'index.ts',
        content: [
          "import type {Graph} from './lib/types.ts';",
          "import {build} from './lib/graph.ts';",
          "import {format} from './format.mjs';",
          "export {helper} from './helper.js';",
          'const graph: Graph = build();',
          'export default format(graph);',
        ].join('\n'),
      },
      {path: 'lib/graph.ts', content: "import {edge} from '../util/edge.mts';\nexport {edge};"},
      {path: 'util/edge.mts', content: 'export const edge = (a: string): string => a;'},
      {path: 'format.mjs', content: "import data from './data.json' with {type: 'json'};"},
      {path: 'helper.js', content: 'export const helper = 1;'},
      {path: 'data.json', content: '{}'},
    ];

    const result = await checkActionImports({files});

    expect(result).toEqual([]);
  });

  it('reports an import of a file that is not in the action', async () => {
    const files = [{path: 'index.ts', content: "import {build} from './lib/graph.ts';"}];

    const result = await checkActionImports({files});

    expect(result).toEqual([
      {
        code: 'action-import-unresolved',
        message: 'index.ts imports ./lib/graph.ts, which is not in the action',
        filePath: 'index.ts',
        specifier: './lib/graph.ts',
      },
    ]);
  });

  it('reports missing imports from nested JavaScript files', async () => {
    const files = [
      {path: 'index.mjs', content: "import './src/main.js';"},
      {path: 'src/main.js', content: "export * from './steps/run.js';"},
    ];

    const result = await checkActionImports({files});

    expect(result).toEqual([
      expect.objectContaining({
        message: 'src/main.js imports ./steps/run.js, which is not in the action',
        filePath: 'src/main.js',
      }),
    ]);
  });

  it('reports an import that leaves the action directory', async () => {
    const files = [
      {path: 'index.ts', content: "import './lib/escape.ts';"},
      {path: 'lib/escape.ts', content: "import {shared} from '../../shared/util.ts';"},
    ];

    const result = await checkActionImports({files});

    expect(result).toEqual([
      {
        code: 'action-import-unresolved',
        message:
          'lib/escape.ts imports ../../shared/util.ts, which is outside the action directory',
        filePath: 'lib/escape.ts',
        specifier: '../../shared/util.ts',
      },
    ]);
  });

  it('reports an extensionless import, which Node does not resolve', async () => {
    const files = [
      {path: 'index.ts', content: "import {build} from './graph';"},
      {path: 'graph.ts', content: 'export const build = 1;'},
    ];

    const result = await checkActionImports({files});

    expect(result).toEqual([expect.objectContaining({specifier: './graph'})]);
  });

  it('checks literal dynamic imports and skips computed ones', async () => {
    const files = [
      {
        path: 'index.ts',
        content: [
          'const name: string = process.env.STEP ?? "a";',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source text.
          'await import(`./steps/${name}.ts`);',
          "await import('./steps/' + name);",
          "await import('./missing.ts');",
        ].join('\n'),
      },
    ];

    const result = await checkActionImports({files});

    expect(result).toEqual([expect.objectContaining({specifier: './missing.ts'})]);
  });

  it('skips bare specifiers, type-only imports, and files it cannot parse', async () => {
    const files = [
      {
        path: 'index.ts',
        content: [
          "import {defineAction} from '@shipfox/actions';",
          "import {readFile} from 'node:fs/promises';",
          "import type {Missing} from './missing.ts';",
          'export default defineAction({run: async (): Promise<Missing> => readFile("x")});',
        ].join('\n'),
      },
      {path: 'broken.ts', content: "import {x} from './missing.ts';\nconst = ;"},
      {path: 'script.cjs', content: "require('./missing.js');"},
    ];

    const result = await checkActionImports({files});

    expect(result).toEqual([]);
  });
});
