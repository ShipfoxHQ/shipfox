import {mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CONTRACTS_WORKFLOW_NAME, type GeneratedFile} from './contract-generator.js';

// `.shipfox-staging/workflows/` at the repository root, because the staging instance reads it.
export const defaultOutputRoot = fileURLToPath(
  new URL('../../../../../.shipfox-staging/workflows/', import.meta.url),
);

const GENERATED_NAME = /^contracts(-[a-z][a-z0-9_]*)?\.yaml$/u;

async function listGeneratedNames(outputRoot: string): Promise<string[]> {
  try {
    const names = await readdir(outputRoot);
    return names.filter((name) => GENERATED_NAME.test(name) || name === CONTRACTS_WORKFLOW_NAME);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Compares the generated files with the ones on disk. A hand edit, a case changed without
 * regenerating, and a leftover file from a removed provider all show up as problems.
 */
export async function findContractDrift({
  generated,
  outputRoot = defaultOutputRoot,
}: {
  generated: GeneratedFile[];
  outputRoot?: string;
}): Promise<string[]> {
  const problems: string[] = [];
  for (const file of generated) {
    const committed = await readIfPresent(join(outputRoot, file.name));
    if (committed === undefined) problems.push(`${file.name} is missing`);
    else if (committed !== file.content)
      problems.push(`${file.name} differs from the generated file`);
  }
  const expected = new Set(generated.map(({name}) => name));
  for (const name of await listGeneratedNames(outputRoot)) {
    if (!expected.has(name)) problems.push(`${name} is not generated from any case`);
  }
  return problems;
}

/** Writes the generated files and removes the contract files that no case generates any more. */
export async function writeContractFiles({
  generated,
  outputRoot = defaultOutputRoot,
}: {
  generated: GeneratedFile[];
  outputRoot?: string;
}): Promise<void> {
  const expected = new Set(generated.map(({name}) => name));
  for (const name of await listGeneratedNames(outputRoot)) {
    if (!expected.has(name)) await rm(join(outputRoot, name));
  }
  if (generated.length === 0) return;
  await mkdir(outputRoot, {recursive: true});
  for (const file of generated) await writeFile(join(outputRoot, file.name), file.content);
}
