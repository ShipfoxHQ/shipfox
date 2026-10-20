import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  COMPOSITE_ACTION_MAX_BYTES,
  COMPOSITE_ACTION_MAX_FILES,
  collectCompositeActions,
} from '@shipfox/registry-format';
import {
  type ActionBundleFile,
  type ActionManifest,
  actionManifestSchema,
  type CompositeActionManifest,
  isCompositeActionManifest,
} from '@shipfox/workflow-document';
import {build, type Message} from 'esbuild';
import {parseDocument} from 'yaml';
import {z} from 'zod';
import {prepareBuildTree, type ResolvedDependency} from './build-tree.js';
import {readDirectoryTextFiles, readOptional, readTrackedTextFiles} from './source-archive.js';

/** The action recipe number stamped into `builder.recipe`. */
export const ACTION_RECIPE = 1;

const ACTION_MAIN = 'index.mjs';
const ACTION_POST = 'post.mjs';
const ACTIONS_PACKAGE = '@shipfox/actions';
// The registry publishes these as their own parts, so a composite bundle leaves them out.
const PACKAGE_METADATA_FILES = new Set(['package.json', 'README.md', 'CHANGELOG.md']);

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
  /**
   * The files of the `action-bundle@1`. A JavaScript action has `action.yml`, `index.mjs`,
   * `post.mjs` when the action declares a post, and `LICENSE` when present. A composite action
   * has the files of its directory that Git tracks, without the package metadata files.
   */
  files: ActionBundleFile[];
  /**
   * For the `source-archive@1`: the build tree without `node_modules` of a JavaScript action,
   * or the tracked files of a composite action directory.
   */
  sourceFiles: ActionBundleFile[];
  dependencies: ResolvedDependency[];
  /** The exact registry actions a composite action uses, sorted. */
  actions: string[];
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
  if (isCompositeActionManifest(sourceManifest)) {
    return await buildCompositeAction({directory, path, manifest: sourceManifest});
  }
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
    const actionYml = withBundledEntries(manifestText, sourceManifest.post !== undefined);
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
        ...(sourceManifest.post === undefined
          ? []
          : [
              {
                path: ACTION_POST,
                content: await bundleAction({
                  directory: join(tree.directory, path),
                  main: sourceManifest.post,
                }),
              },
            ]),
        ...(license === undefined ? [] : [{path: 'LICENSE', content: license}]),
      ],
      sourceFiles: await readDirectoryTextFiles(tree.directory),
      dependencies: tree.dependencies,
      actions: [],
    };
  } finally {
    await tree.remove();
  }
}

/**
 * A composite action has nothing to build: the bundle is its directory as written, so the files
 * its steps read through `${{ action.path }}` ship with it.
 */
async function buildCompositeAction({
  directory,
  path,
  manifest,
}: {
  directory: string;
  path: string;
  manifest: CompositeActionManifest;
}): Promise<ActionBuild> {
  const actions = collectCompositeActions(manifest);
  if (!actions.ok) throw new Error(`${path}: uses ${actions.uses}: ${actions.message}`);

  const sourceFiles = await readTrackedTextFiles(directory);
  const files = sourceFiles.filter((file) => !PACKAGE_METADATA_FILES.has(file.path));
  if (!files.some((file) => file.path === 'action.yml')) {
    throw new Error(`${path}: action.yml is not tracked by Git, so the bundle would leave it out`);
  }
  if (files.length > COMPOSITE_ACTION_MAX_FILES) {
    throw new Error(
      `${path}: a composite action holds at most ${COMPOSITE_ACTION_MAX_FILES} files`,
    );
  }
  const bytes = files.reduce((total, {content}) => total + Buffer.byteLength(content, 'utf8'), 0);
  if (bytes > COMPOSITE_ACTION_MAX_BYTES) {
    throw new Error(
      `${path}: a composite action holds at most ${COMPOSITE_ACTION_MAX_BYTES} bytes of files`,
    );
  }
  return {manifest, files, sourceFiles, dependencies: [], actions: actions.actions};
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

/** The action manifest with the entries pointing at the bundle, keeping the author's formatting. */
function withBundledEntries(manifestText: string, hasPost: boolean): string {
  const document = parseDocument(manifestText);
  document.set('main', ACTION_MAIN);
  if (hasPost) document.set('post', ACTION_POST);
  return document.toString();
}

function describeMessage({text, location}: Message): string {
  return location === null ? `- ${text}` : `- ${location.file}:${location.line}: ${text}`;
}
