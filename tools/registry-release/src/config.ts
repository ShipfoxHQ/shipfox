import type {Dirent} from 'node:fs';
import {readdir, readFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {registryPackageKindSchema, registrySlugSchema} from '@shipfox/registry-format';
import {parse as parseYaml} from 'yaml';
import {z} from 'zod';

const configSchema = z.strictObject({
  registry: z.url(),
  namespace: registrySlugSchema,
  packages: z
    .array(
      z.strictObject({
        kind: registryPackageKindSchema,
        // One `*` as the last segment: every directory below the parent is a package.
        path: z.string().regex(/^[^*]+\/\*$/, 'Expected a directory pattern ending in /*'),
        // `false` keeps the packages built and checked, but out of every release.
        publish: z.boolean().default(true),
      }),
    )
    .min(1),
});

export type RegistryReleaseConfig = z.infer<typeof configSchema>;

export interface ConfiguredPackage {
  /** `namespace/name`. The name is the directory name. */
  package: string;
  kind: RegistryReleaseConfig['packages'][number]['kind'];
  /** The repository root. */
  root: string;
  /** Repository-relative, with `/` separators. */
  path: string;
  directory: string;
  /** Whether `publish` uploads the package. */
  publish: boolean;
}

export async function loadConfig(path: string): Promise<RegistryReleaseConfig> {
  const result = configSchema.safeParse(parseYaml(await readFile(path, 'utf8')));
  if (!result.success) {
    throw new Error(`Invalid registry release config ${path}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** Expands the package globs below the repository root, sorted by path. */
export async function discoverPackages({
  root,
  config,
}: {
  root: string;
  config: RegistryReleaseConfig;
}): Promise<ConfiguredPackage[]> {
  const found: ConfiguredPackage[] = [];
  for (const {kind, path: pattern, publish} of config.packages) {
    const parent = pattern.slice(0, -'/*'.length);
    for (const entry of await readPackageDirectories(join(root, parent))) {
      if (!entry.isDirectory()) continue;
      const name = basename(entry.name);
      if (!registrySlugSchema.safeParse(name).success) {
        throw new Error(`${parent}/${name} is not a valid package name`);
      }
      found.push({
        package: `${config.namespace}/${name}`,
        kind,
        root,
        path: `${parent}/${name}`,
        directory: join(root, parent, name),
        publish,
      });
    }
  }
  return found.sort(byPath);
}

// A pattern whose parent does not exist yet, such as an empty catalog section, has no packages.
async function readPackageDirectories(parent: string): Promise<Dirent[]> {
  try {
    return await readdir(parent, {withFileTypes: true});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

// Code-unit order, so the order never depends on the runtime locale.
function byPath(a: ConfiguredPackage, b: ConfiguredPackage): number {
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}
