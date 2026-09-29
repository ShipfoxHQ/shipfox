import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parse as parseYaml} from 'yaml';
import type {PartBlocks, PartProviderBlocks} from './composer.js';
import {createTemplateLoader, type TemplateLoader, type WorkflowTemplateAsset} from './loader.js';

const versionPattern = /^(\d+)\./;

/**
 * Serves the template packages of a catalog directory, such as `libs/shared/workflow/catalog/templates`.
 * Each subdirectory holds `package.json`, `template.yaml`, `workflow.yml`, `GUIDE.md`, and
 * `parts/<role>/<provider>.yml`. The directory is read on first use.
 *
 * Catalog packages carry no embedded compatibility file, so `revision` is the package's major
 * version, `rank` is the position in id order, and `added_at` is the epoch.
 */
export function createDirectoryTemplateLoader(path: string): TemplateLoader {
  let loader: Promise<TemplateLoader> | undefined;
  const load = () => {
    loader ??= readCatalog(path).then(createTemplateLoader);
    return loader;
  };

  return {
    list: async () => (await load()).list(),
    get: async (params) => (await load()).get(params),
    versions: async (params) => (await load()).versions(params),
    compose: async (params) => (await load()).compose(params),
  };
}

async function readCatalog(path: string): Promise<WorkflowTemplateAsset[]> {
  const entries = await readdir(path, {withFileTypes: true});
  const ids = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    ids.map((id, index) => readTemplate({root: join(path, id), id, rank: index + 1})),
  );
}

async function readTemplate({
  root,
  id,
  rank,
}: {
  root: string;
  id: string;
  rank: number;
}): Promise<WorkflowTemplateAsset> {
  const {version} = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
    version: string;
  };
  return {
    id,
    version,
    revision: Number(versionPattern.exec(version)?.[1] ?? 1),
    added_at: '1970-01-01',
    rank,
    manifest: await readFile(join(root, 'template.yaml'), 'utf8'),
    workflow: await readFile(join(root, 'workflow.yml'), 'utf8'),
    guide: await readFile(join(root, 'GUIDE.md'), 'utf8'),
    parts: await readParts(join(root, 'parts')),
  };
}

async function readParts(root: string): Promise<PartProviderBlocks> {
  const parts: Record<string, Record<string, PartBlocks>> = {};
  for (const role of await readdir(root, {withFileTypes: true})) {
    if (!role.isDirectory()) continue;
    const providers: Record<string, PartBlocks> = {};
    for (const file of await readdir(join(root, role.name), {withFileTypes: true})) {
      if (!(file.isFile() && file.name.endsWith('.yml'))) continue;
      const blocks = parseYaml(await readFile(join(root, role.name, file.name), 'utf8')) as unknown;
      if (!isPartBlocks(blocks)) {
        throw new Error(`Invalid provider part file ${join(root, role.name, file.name)}`);
      }
      providers[file.name.slice(0, -'.yml'.length)] = blocks;
    }
    parts[role.name] = providers;
  }
  return parts;
}

function isPartBlocks(value: unknown): value is PartBlocks {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((block) => typeof block === 'string')
  );
}
