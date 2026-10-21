import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preflightCheck} from '@shipfox/e2e-core';
import {arrangeCompileStack, bindConnectionSlugs, compileResult} from './compile.js';
import {matchesCase} from './discovery.js';
import {type CaseResult, createRunId, type ResultsRun, writeResults} from './results.js';

const WORKFLOW_FILE = /\.ya?ml$/u;
const BIND_MARKER = /# bind:([A-Za-z0-9_-]+)\s*$/gmu;
const STAGING_WORKFLOWS_DIRECTORY = '.shipfox-staging/workflows';
// The directory at the repository root that the staging instance syncs.
const stagingWorkflowsRoot = fileURLToPath(
  new URL(`../../../../../${STAGING_WORKFLOWS_DIRECTORY}/`, import.meta.url),
);

export interface ContractWorkflowFile {
  /** The path the staging project syncs the file from, such as `.shipfox-staging/workflows/contracts.yaml`. */
  id: string;
  yaml: string;
}

/**
 * Every workflow file in the directory the staging instance syncs. One invalid file fails the
 * whole sync, so every file counts, not only the generated ones. A missing directory has none.
 */
export async function listContractWorkflows({
  directory = stagingWorkflowsRoot,
  filter,
}: {
  directory?: string;
  filter?: string | undefined;
} = {}): Promise<ContractWorkflowFile[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: ContractWorkflowFile[] = [];
  for (const name of names.filter((entry) => WORKFLOW_FILE.test(entry)).sort()) {
    const id = `${STAGING_WORKFLOWS_DIRECTORY}/${name}`;
    if (matchesCase(name, filter) || matchesCase(id, filter))
      files.push({id, yaml: await readFile(join(directory, name), 'utf8')});
  }
  return files;
}

/** The providers whose sandbox connections the file marks with `# bind:<provider>`. */
export function boundProviders(yaml: string): string[] {
  return [...new Set([...yaml.matchAll(BIND_MARKER)].map(([, provider]) => provider as string))];
}

export interface ContractsCompileOptions {
  /** Compiles the files whose name or path matches, all of them when unset. */
  caseFilter?: string;
  /** A directory of workflow files to compile instead of `.shipfox-staging/workflows`. */
  workflowsDirectory?: string;
  resultsDirectory?: string;
  runId?: string;
  /** Replaces compilation against the running stack, which tests don't have. */
  compile?: (file: ContractWorkflowFile) => Promise<CaseResult>;
}

/**
 * Creates a definition for every contract workflow file on the running stack, with a connection
 * for each sandbox the files use, and requires zero error diagnostics and every trigger active.
 */
export async function runContractsCompile(
  options: ContractsCompileOptions = {},
): Promise<ResultsRun> {
  const files = await listContractWorkflows({
    ...(options.workflowsDirectory === undefined ? {} : {directory: options.workflowsDirectory}),
    filter: options.caseFilter,
  });
  if (files.length === 0 && options.caseFilter !== undefined) {
    throw new Error(`No contract workflow files matching "${options.caseFilter}" were found.`);
  }
  const cleanups: Array<() => Promise<void>> = [];
  try {
    let compile = options.compile;
    if (compile === undefined && files.length > 0) {
      await preflightCheck({requireClient: false});
      const stack = await arrangeCompileStack({cleanups});
      compile = (file) =>
        compileResult({
          id: file.id,
          compile: async (result) => {
            const slugs: Record<string, string> = {};
            for (const provider of boundProviders(file.yaml)) {
              slugs[provider] = await stack.slugOf(provider);
            }
            const yaml = bindConnectionSlugs({yaml: file.yaml, slugs});
            result.composed_yaml = yaml;
            return await stack.check(yaml);
          },
        });
    }
    const compileFile = compile;
    return await writeResults({
      cases: files,
      mode: 'compile',
      repeat: 1,
      execute: ({discovered}) => {
        if (compileFile === undefined) throw new Error('No compile function for the files.');
        return compileFile(discovered);
      },
      runId: options.runId ?? createRunId(),
      ...(options.resultsDirectory === undefined
        ? {}
        : {resultsDirectory: options.resultsDirectory}),
    });
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
  }
}
