import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  type ActionBundleFile,
  type ActionManifest,
  actionManifestSchema,
} from '@shipfox/workflow-document';
import {build, type Message} from 'esbuild';
import {parseDocument} from 'yaml';
import {z} from 'zod';
import {prepareBuildTree, type ResolvedDependency} from './build-tree.js';
import {readDirectoryTextFiles, readOptional} from './source-archive.js';

/** The action recipe number stamped into `builder.recipe`. */
export const ACTION_RECIPE = 1;

const ACTION_MAIN = 'index.mjs';
const ACTIONS_PACKAGE = '@shipfox/actions';

// esbuild leaves these calls in place and logs them at debug level, even in
// dependencies. The bundle could not resolve them at run time.
const UNRESOLVED_REQUIRES = {
  'unsupported-require-call': 'error',
  'unsupported-dynamic-import': 'error',
} as const;

// CommonJS dependencies call `require`, which an ES module does not have.
const CREATE_REQUIRE_BANNER = [
  "import {createRequire as __shipfoxCreateRequire} from 'node:module';",
  'const require = __shipfoxCreateRequire(import.meta.url);',
].join('\n');

const actionPackageJsonSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
});

export interface ActionBuild {
  manifest: ActionManifest;
  /** The files of the `action-bundle@1`: `action.yml`, `index.mjs`, and `LICENSE` when present. */
  files: ActionBundleFile[];
  /** The build tree without `node_modules`, for the `source-archive@1`. */
  sourceFiles: ActionBundleFile[];
  dependencies: ResolvedDependency[];
}

export async function buildAction({
  root,
  path,
  workspaceName,
}: {
  root: string;
  /** The action directory, relative to `root`. */
  path: string;
  workspaceName: string;
}): Promise<ActionBuild> {
  const directory = join(root, path);
  const manifestText = await readFile(join(directory, 'action.yml'), 'utf8');
  const sourceManifest = actionManifestSchema.parse(parseDocument(manifestText).toJS());
  const packageJson = actionPackageJsonSchema.parse(
    JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')),
  );
  if (packageJson.dependencies?.[ACTIONS_PACKAGE] !== undefined) {
    throw new Error(
      `${path}: ${ACTIONS_PACKAGE} must be in devDependencies. The runner provides it, so it is never bundled.`,
    );
  }

  const tree = await prepareBuildTree({root, workspaceName});
  try {
    const actionYml = withBundledMain(manifestText);
    const license = await readOptional(join(tree.directory, path, 'LICENSE'));
    return {
      manifest: actionManifestSchema.parse(parseDocument(actionYml).toJS()),
      files: [
        {path: 'action.yml', content: actionYml},
        {
          path: ACTION_MAIN,
          content: await bundleAction({
            directory: join(tree.directory, path),
            main: sourceManifest.main,
          }),
        },
        ...(license === undefined ? [] : [{path: 'LICENSE', content: license}]),
      ],
      sourceFiles: await readDirectoryTextFiles(tree.directory),
      dependencies: tree.dependencies,
    };
  } finally {
    await tree.remove();
  }
}

/**
 * Bundles an action entry file with the pinned esbuild options. Workspace
 * packages resolve to their sources through the `workspace-source` condition.
 * No tsconfig file is read, so the author's compiler settings and the files a
 * pruned tree lacks cannot change the output. A native `.node` file fails,
 * because no loader handles it.
 */
export async function bundleAction({
  directory,
  main,
}: {
  directory: string;
  main: string;
}): Promise<string> {
  const result = await build({
    absWorkingDir: directory,
    entryPoints: [main],
    outfile: ACTION_MAIN,
    write: false,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    conditions: ['workspace-source'],
    external: [ACTIONS_PACKAGE, `${ACTIONS_PACKAGE}/*`],
    legalComments: 'eof',
    minify: false,
    sourcemap: false,
    banner: {js: CREATE_REQUIRE_BANNER},
    tsconfigRaw: {},
    logOverride: UNRESOLVED_REQUIRES,
    logLevel: 'silent',
  }).catch((error: unknown) => {
    const errors = (error as {errors?: Message[]}).errors;
    if (errors === undefined) throw error;
    throw new Error(`The action bundle failed:\n${errors.map(describeMessage).join('\n')}`, {
      cause: error,
    });
  });

  const [output] = result.outputFiles;
  if (output === undefined) throw new Error('esbuild wrote no output');
  return output.text;
}

/** The action manifest with `main` pointing at the bundle, keeping the author's formatting. */
function withBundledMain(manifestText: string): string {
  const document = parseDocument(manifestText);
  document.set('main', ACTION_MAIN);
  return document.toString();
}

function describeMessage({text, location}: Message): string {
  return location === null ? `- ${text}` : `- ${location.file}:${location.line}: ${text}`;
}
