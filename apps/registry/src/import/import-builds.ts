import {readdir, readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {
  compareRegistryVersions,
  parseRegistryPackageName,
  registryPackageKindSchema,
} from '@shipfox/registry-format';
import {z} from 'zod';
import type {PublishVersionResult, VersionImporter} from '#publish/publish-version.js';
import type {PublishRequestParts} from '#publish/request.js';

/** The files the release tool's `build` writes for one version. */
const BUILD_SUMMARY = 'build.json';
const DRAFT = 'draft.json';
const CONTENT = 'content.gz';
const SOURCE = 'source.gz';
const README = 'README.md';

const buildSummarySchema = z.object({
  package: z.string(),
  kind: registryPackageKindSchema,
  version: z.string(),
});

export interface BuildOutput {
  directory: string;
  namespace: string;
  name: string;
  kind: z.infer<typeof registryPackageKindSchema>;
  version: string;
}

export interface ImportedVersion extends BuildOutput {
  created: PublishVersionResult['created'];
}

/**
 * Imports every version built below `directory`. Actions go first, because a template's actions
 * must exist, and lower versions go first, because a version's bump is checked against them.
 */
export async function importBuildOutputs({
  directory,
  importVersion,
}: {
  directory: string;
  importVersion: VersionImporter;
}): Promise<ImportedVersion[]> {
  const outputs = await findBuildOutputs(directory);
  if (outputs.length === 0) throw new Error(`No ${BUILD_SUMMARY} below ${directory}`);
  const imported: ImportedVersion[] = [];
  for (const output of outputs) {
    const {created} = await importVersion({
      namespace: output.namespace,
      name: output.name,
      version: output.version,
      parts: await readParts(output.directory),
    });
    imported.push({...output, created});
  }
  return imported;
}

export async function findBuildOutputs(directory: string): Promise<BuildOutput[]> {
  const entries = await readdir(directory, {recursive: true, withFileTypes: true});
  const outputs = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name === BUILD_SUMMARY)
      .map((entry) => readBuildOutput(join(entry.parentPath, entry.name))),
  );
  return outputs.sort(
    (a, b) =>
      Number(a.kind === 'template') - Number(b.kind === 'template') ||
      `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`) ||
      compareRegistryVersions(a.version, b.version),
  );
}

async function readBuildOutput(summaryPath: string): Promise<BuildOutput> {
  const summary = buildSummarySchema.parse(JSON.parse(await readFile(summaryPath, 'utf8')));
  const name = parseRegistryPackageName(summary.package);
  if (name === undefined) {
    throw new Error(`${summaryPath} names ${JSON.stringify(summary.package)}, not ns/name`);
  }
  return {directory: dirname(summaryPath), ...name, kind: summary.kind, version: summary.version};
}

async function readParts(directory: string): Promise<PublishRequestParts> {
  const [draft, content, source, readme] = await Promise.all([
    readFile(join(directory, DRAFT), 'utf8'),
    readFile(join(directory, CONTENT)),
    readFile(join(directory, SOURCE)),
    readFile(join(directory, README)).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }),
  ]);
  return {draft, content, source, readme};
}
