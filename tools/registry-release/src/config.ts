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
      }),
    )
    .min(1),
});

export type RegistryReleaseConfig = z.infer<typeof configSchema>;

export interface ConfiguredPackage {
  /** `namespace/name`. The name is the directory name. */
  package: string;
  kind: RegistryReleaseConfig['packages'][number]['kind'];
  /** Repository-relative, with `/` separators. */
  path: string;
  directory: string;
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
  for (const {kind, path: pattern} of config.packages) {
    const parent = pattern.slice(0, -'/*'.length);
    const entries = await readdir(join(root, parent), {withFileTypes: true});
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = basename(entry.name);
      if (!registrySlugSchema.safeParse(name).success) {
        throw new Error(`${parent}/${name} is not a valid package name`);
      }
      found.push({
        package: `${config.namespace}/${name}`,
        kind,
        path: `${parent}/${name}`,
        directory: join(root, parent, name),
      });
    }
  }
  return found.sort(byPath);
}

// Code-unit order, so the order never depends on the runtime locale.
function byPath(a: ConfiguredPackage, b: ConfiguredPackage): number {
  if (a.path === b.path) return 0;
  return a.path < b.path ? -1 : 1;
}
