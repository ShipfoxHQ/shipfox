import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PACKAGE_NOT_FOUND_HINT, REGISTRY_IMPORT_ERROR_MESSAGE} from '#module-resolution.js';
import {
  type ActionSandbox,
  createActionSandbox,
  linkDirectory,
  runActionProcess,
  sdkEntryPath,
  writeFiles,
  writePackage,
} from '#test/fixtures/action-process.js';

const reportAction = (imports: string, value: string) => `
  import {defineAction} from '@shipfox/actions';
  ${imports}

  export default defineAction(() => ({value: ${value}}));
`;

describe('loader', () => {
  let sandbox: ActionSandbox;

  beforeEach(async () => {
    sandbox = await createActionSandbox();
  });

  afterEach(async () => {
    await sandbox.cleanup();
  });

  function run(origin?: 'local' | 'registry') {
    return runActionProcess({sandbox, origin, outputs: {value: {type: 'string'}}});
  }

  it('resolves packages from an npm hoisted layout in the step working directory', async () => {
    const modules = join(sandbox.workspace, 'node_modules');
    await writePackage(join(modules, 'a'), {
      name: 'a',
      index: "import {b} from 'b'; export const a = () => 'a+' + b();",
    });
    await writePackage(join(modules, 'b'), {name: 'b', index: "export const b = () => 'b';"});
    await writeFiles(sandbox.bundle, {'index.js': reportAction("import {a} from 'a';", 'a()')});

    const result = await run();

    expect(result).toMatchObject({result: {status: 'succeeded'}, outputs: {value: 'a+b'}});
  });

  it('lets a package resolve a transitive dependency that only an isolated pnpm layout provides', async () => {
    const store = join(sandbox.workspace, 'node_modules', '.pnpm');
    const aDir = join(store, 'a@1.0.0', 'node_modules', 'a');
    const bDir = join(store, 'b@1.0.0', 'node_modules', 'b');
    await writePackage(aDir, {
      name: 'a',
      index: "import {b} from 'b'; export const a = () => 'a+' + b();",
      dependencies: {b: '1.0.0'},
    });
    await writePackage(bDir, {name: 'b', index: "export const b = () => 'b';"});
    await linkDirectory(bDir, join(store, 'a@1.0.0', 'node_modules', 'b'));
    await linkDirectory(aDir, join(sandbox.workspace, 'node_modules', 'a'));
    await writeFiles(sandbox.bundle, {'index.js': reportAction("import {a} from 'a';", 'a()')});

    const result = await run();

    expect(result).toMatchObject({result: {status: 'succeeded'}, outputs: {value: 'a+b'}});
  });

  it('resolves a workspace:* package and its own dependencies', async () => {
    const utilDir = join(sandbox.workspace, 'packages', 'util');
    await writePackage(utilDir, {
      name: '@acme/util',
      index: "import {c} from 'c'; export const util = () => 'util+' + c();",
      dependencies: {c: '1.0.0'},
    });
    await writePackage(join(utilDir, 'node_modules', 'c'), {
      name: 'c',
      index: "export const c = () => 'c';",
    });
    await linkDirectory(utilDir, join(sandbox.workspace, 'node_modules', '@acme', 'util'));
    await writeFiles(sandbox.bundle, {
      'index.js': reportAction("import {util} from '@acme/util';", 'util()'),
    });

    const result = await run();

    expect(result).toMatchObject({result: {status: 'succeeded'}, outputs: {value: 'util+c'}});
  });

  it("gives a package that imports @shipfox/actions the runner's SDK copy", async () => {
    await writePackage(join(sandbox.workspace, 'node_modules', 'helper'), {
      name: 'helper',
      index: `
        export {ToolCallError} from '@shipfox/actions';
        export const sdkUrl = import.meta.resolve('@shipfox/actions');
      `,
    });
    await writeFiles(sandbox.bundle, {
      'index.js': `
        import {defineAction, ToolCallError} from '@shipfox/actions';
        import * as helper from 'helper';

        export default defineAction(() => ({
          value: JSON.stringify({same: helper.ToolCallError === ToolCallError, url: helper.sdkUrl}),
        }));
      `,
    });

    const result = await run();

    expect(result.result).toEqual({status: 'succeeded'});
    expect(JSON.parse(result.outputs.value ?? '')).toEqual({
      same: true,
      url: pathToFileURL(sdkEntryPath).href,
    });
  });

  it('rejects a relative import that escapes the action directory', async () => {
    await writeFiles(sandbox.root, {'job/secret.js': "export const secret = 'leaked';"});
    await writeFiles(sandbox.bundle, {
      'index.js': reportAction("import {secret} from '../../secret.js';", 'secret'),
    });

    const result = await run();

    expect(result.exitCode).toBe(1);
    expect(result.result).toEqual({status: 'failed'});
    expect(result.stderr).toContain(
      `'../../secret.js' imported from ${join(sandbox.bundle, 'index.js')} resolves outside the action directory.`,
    );
  });

  it('points to an earlier install step when a package is missing from the working directory', async () => {
    const store = join(sandbox.workspace, 'node_modules', '.pnpm');
    await writePackage(join(store, 'b@1.0.0', 'node_modules', 'b'), {
      name: 'b',
      index: "export const b = () => 'b';",
    });
    await writeFiles(sandbox.bundle, {'index.js': reportAction("import {b} from 'b';", 'b()')});

    const result = await run();

    expect(result.exitCode).toBe(1);
    expect(result.result).toEqual({status: 'failed'});
    expect(result.stderr).toContain(
      `Cannot find package 'b' imported from ${join(sandbox.bundle, 'index.js')}, looked up from ${sandbox.workspace}. ${PACKAGE_NOT_FOUND_HINT}`,
    );
  });

  it('keeps the resolution error for a missing file inside an installed package', async () => {
    // No `exports` field, so a subpath resolves straight to a file.
    await writeFiles(join(sandbox.workspace, 'node_modules', 'pkg'), {
      'package.json': JSON.stringify({name: 'pkg', type: 'module'}),
    });
    await writeFiles(sandbox.bundle, {
      'index.js': reportAction("import 'pkg/missing.js';", "'unreachable'"),
    });

    const result = await run();

    expect(result.exitCode).toBe(1);
    expect(result.result).toEqual({status: 'failed'});
    expect(result.stderr).toContain(
      `Cannot find module '${join(sandbox.workspace, 'node_modules', 'pkg', 'missing.js')}'`,
    );
    expect(result.stderr).not.toContain(PACKAGE_NOT_FOUND_HINT);
  });

  describe('registry origin', () => {
    it('rejects a workspace package for a registry action and allows it for a local one', async () => {
      await writePackage(join(sandbox.workspace, 'node_modules', 'helper'), {
        name: 'helper',
        index: "export const help = () => 'helped';",
      });
      await writeFiles(sandbox.bundle, {
        'index.js': reportAction("import {help} from 'helper';", 'help()'),
      });

      const registry = await run('registry');
      const local = await run('local');

      expect(registry.exitCode).toBe(1);
      expect(registry.result).toEqual({status: 'failed'});
      expect(registry.stderr).toContain('ERR_SHIPFOX_REGISTRY_ACTION_IMPORT');
      expect(registry.stderr).toContain(REGISTRY_IMPORT_ERROR_MESSAGE);
      expect(local).toMatchObject({result: {status: 'succeeded'}, outputs: {value: 'helped'}});
    });

    it('rejects a scoped package for a registry action', async () => {
      await writePackage(join(sandbox.workspace, 'node_modules', '@acme', 'util'), {
        name: '@acme/util',
        index: "export const util = () => 'util';",
      });
      await writeFiles(sandbox.bundle, {
        'index.js': reportAction("import {util} from '@acme/util';", 'util()'),
      });

      const result = await run('registry');

      expect(result.stderr).toContain('ERR_SHIPFOX_REGISTRY_ACTION_IMPORT');
      expect(result.stderr).toContain("'@acme/util'");
    });

    it('allows the SDK, node: built-ins, and files inside the bundle', async () => {
      await writeFiles(sandbox.bundle, {
        'helper.js': "export const greet = () => 'hi';",
        'index.js': reportAction(
          "import {basename} from 'node:path'; import {greet} from './helper.js';",
          "greet() + basename('/a/b')",
        ),
      });

      const result = await run('registry');

      expect(result).toMatchObject({result: {status: 'succeeded'}, outputs: {value: 'hib'}});
    });
  });
});
