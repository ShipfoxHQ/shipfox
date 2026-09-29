import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  computeFingerprint,
  isRegistryVersion,
  type RegistryPackageKind,
  type RegistryReference,
} from '@shipfox/registry-format';
import {type ActionBundleFile, encodeActionBundle} from '@shipfox/workflow-document';
import {CURRENT_COMPOSITION} from '@shipfox/workflow-templates';
import {z} from 'zod';
import {ACTION_RECIPE, buildAction} from './action-recipe.js';
import type {ResolvedDependency} from './build-tree.js';
import {extractChangelogSection} from './changelog.js';
import type {ConfiguredPackage} from './config.js';
import {encodeSourceArchive, readOptional, readTrackedTextFiles} from './source-archive.js';
import {
  collectRegistryActions,
  composeTemplateVariants,
  readTemplateSource,
  TEMPLATE_RECIPE,
} from './template-recipe.js';

export const REGISTRY_RELEASE_TOOL = '@shipfox/registry-release';
export const BUILD_OUTPUT_DIRECTORY = '.shipfox-registry';

const packageJsonSchema = z.object({
  name: z.string().min(1),
  version: z.string().refine(isRegistryVersion, 'Expected an exact version, such as 1.4.2'),
  license: z.string().optional(),
});

export interface BuiltBlob {
  digest: string;
  bytes: number;
  gzip: Uint8Array;
}

/** One package version, built and ready to compare or upload. */
export interface BuiltPackage {
  /** `namespace/name`. */
  package: string;
  kind: RegistryPackageKind;
  version: string;
  /** The `name` in `package.json`, which a changeset names. */
  workspaceName: string;
  path: string;
  license: string | undefined;
  manifest: Record<string, unknown>;
  changelog: string | undefined;
  readme: {text: string; digest: string; bytes: number} | undefined;
  content: BuiltBlob & {format: 'action-bundle@1' | 'template-bundle@1'};
  source: BuiltBlob & {format: 'source-archive@1'};
  /** The exact registry references the package uses. */
  actions: string[];
  /** The composition format of the composer that checked the template. */
  composition: number | undefined;
  /** The external packages an action bundles. */
  dependencies: ResolvedDependency[] | undefined;
  builder: {tool: string; version: string; recipe: number};
  fingerprint: string;
}

/** What a recipe produces from a package directory. */
interface RecipeOutput {
  manifest: Record<string, unknown>;
  contentFiles: ActionBundleFile[];
  sourceFiles: ActionBundleFile[];
  actions: string[];
  composition: number | undefined;
  dependencies: ResolvedDependency[] | undefined;
  recipe: number;
}

export async function buildPackage({
  configured,
  toolVersion,
}: {
  configured: ConfiguredPackage;
  toolVersion: string;
}): Promise<BuiltPackage> {
  const {directory} = configured;
  const packageJson = packageJsonSchema.parse(
    JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')),
  );
  const [namespace = '', name = ''] = configured.package.split('/');
  const reference = {namespace, name, version: packageJson.version};

  const output =
    configured.kind === 'action'
      ? await runActionRecipe({configured, workspaceName: packageJson.name})
      : await runTemplateRecipe({directory, reference});
  const content = await encodeActionBundle({files: output.contentFiles});
  const source = await encodeSourceArchive(output.sourceFiles);

  const readmeText = await readOptional(join(directory, 'README.md'));
  const readme =
    readmeText === undefined ? undefined : {...(await digestText(readmeText)), text: readmeText};
  const changelogText = await readOptional(join(directory, 'CHANGELOG.md'));
  const changelog =
    changelogText === undefined
      ? undefined
      : extractChangelogSection({changelog: changelogText, version: packageJson.version});

  const built = {
    package: configured.package,
    kind: configured.kind,
    version: packageJson.version,
    workspaceName: packageJson.name,
    path: configured.path,
    license: packageJson.license,
    manifest: output.manifest,
    changelog,
    readme,
    content: {
      digest: content.digest,
      bytes: content.bytes,
      gzip: content.gzip,
      format: configured.kind === 'action' ? 'action-bundle@1' : 'template-bundle@1',
    },
    source: {
      digest: source.digest,
      bytes: source.bytes,
      gzip: source.gzip,
      format: 'source-archive@1',
    },
    actions: output.actions,
    composition: output.composition,
    dependencies: output.dependencies,
    builder: {tool: REGISTRY_RELEASE_TOOL, version: toolVersion, recipe: output.recipe},
  } as const;

  const fingerprint = await computeFingerprint({
    package: built.package,
    kind: built.kind,
    version: built.version,
    license: built.license ?? '',
    manifest: built.manifest,
    changelog: built.changelog,
    dependencies: built.dependencies,
    actions: built.actions,
    content: {digest: built.content.digest},
    source: {digest: built.source.digest},
    readme: built.readme && {digest: built.readme.digest},
    builder: {recipe: built.builder.recipe},
  });
  return {...built, fingerprint};
}

async function runActionRecipe({
  configured,
  workspaceName,
}: {
  configured: ConfiguredPackage;
  workspaceName: string;
}): Promise<RecipeOutput> {
  const action = await buildAction({root: configured.root, path: configured.path, workspaceName});
  return {
    manifest: action.manifest,
    contentFiles: action.files,
    sourceFiles: action.sourceFiles,
    actions: [],
    composition: undefined,
    dependencies: action.dependencies,
    recipe: ACTION_RECIPE,
  };
}

async function runTemplateRecipe({
  directory,
  reference,
}: {
  directory: string;
  reference: RegistryReference;
}): Promise<RecipeOutput> {
  const templateSource = await readTemplateSource(directory);
  const variants = composeTemplateVariants({reference, source: templateSource});
  return {
    manifest: templateSource.manifest,
    contentFiles: templateSource.files,
    sourceFiles: await readTrackedTextFiles(directory),
    actions: collectRegistryActions(variants),
    composition: CURRENT_COMPOSITION,
    dependencies: undefined,
    recipe: TEMPLATE_RECIPE,
  };
}

/** Writes the blobs and a summary below `<root>/.shipfox-registry/<ns>/<name>/<version>/`. */
export async function writeBuildOutput({
  root,
  built,
}: {
  root: string;
  built: BuiltPackage;
}): Promise<string> {
  const directory = join(root, BUILD_OUTPUT_DIRECTORY, built.package, built.version);
  await mkdir(directory, {recursive: true});
  await writeFile(join(directory, 'content.gz'), built.content.gzip);
  await writeFile(join(directory, 'source.gz'), built.source.gzip);
  if (built.readme) await writeFile(join(directory, 'README.md'), built.readme.text);
  await writeFile(join(directory, 'build.json'), `${JSON.stringify(summarize(built), null, 2)}\n`);
  return directory;
}

export function summarize(built: BuiltPackage) {
  return {
    package: built.package,
    kind: built.kind,
    version: built.version,
    fingerprint: built.fingerprint,
    content: {digest: built.content.digest, bytes: built.content.bytes},
    source: {digest: built.source.digest, bytes: built.source.bytes},
    readme: built.readme && {digest: built.readme.digest, bytes: built.readme.bytes},
    actions: built.actions,
    composition: built.composition,
    dependencies: built.dependencies,
    builder: built.builder,
  };
}

async function digestText(text: string) {
  const bytes = new TextEncoder().encode(text);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return {digest: `sha256:${hex}`, bytes: bytes.byteLength};
}
