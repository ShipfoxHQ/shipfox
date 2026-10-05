import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {preflightCheck} from '@shipfox/e2e-core';
import {arrangeCompileStack, bindConnectionSlugs, compileResult} from './compile.js';
import {GENERATED_WORKFLOWS_DIRECTORY} from './contract-generator.js';
import {defaultOutputRoot} from './contract-output.js';
import type {SandboxManifest} from './contract-schema.js';
import {loadContracts} from './contracts.js';
import {matchesCase} from './discovery.js';
import {type CaseResult, createRunId, type ResultsRun, writeResults} from './results.js';

const WORKFLOW_FILE = /\.ya?ml$/u;
const CONNECTION_LINE = /^(\s*(?:-\s+)?connection:\s*)([A-Za-z0-9_-]+)\s*$/u;

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
  directory = defaultOutputRoot,
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
    const id = `${GENERATED_WORKFLOWS_DIRECTORY}/${name}`;
    if (matchesCase(name, filter) || matchesCase(id, filter))
      files.push({id, yaml: await readFile(join(directory, name), 'utf8')});
  }
  return files;
}

/**
 * Marks each step connection that names a sandbox slug, such as `linear_sandbox`, with the role
 * that `bindConnectionSlugs` replaces. Returns the providers whose sandbox the file uses.
 */
export function markSandboxConnections({
  yaml,
  manifest,
}: {
  yaml: string;
  manifest: SandboxManifest;
}): {yaml: string; providers: string[]} {
  const providers = new Set<string>();
  const marked = yaml
    .split('\n')
    .map((line) => {
      const slug = CONNECTION_LINE.exec(line)?.[2];
      const provider = Object.keys(manifest).find((name) => manifest[name]?.connection === slug);
      if (provider === undefined) return line;
      providers.add(provider);
      return `${line.trimEnd()} # bind:${provider}`;
    })
    .join('\n');
  return {yaml: marked, providers: [...providers]};
}

export interface ContractsCompileOptions {
  /** Compiles the files whose name or path matches, all of them when unset. */
  caseFilter?: string;
  /** A directory of workflow files to compile instead of `.shipfox-staging/workflows`. */
  workflowsDirectory?: string;
  /** The sandbox manifest the files were generated from, read from the cases when unset. */
  manifest?: SandboxManifest;
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
  const manifest = options.manifest ?? (await loadContracts()).manifest;

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
            const marked = markSandboxConnections({yaml: file.yaml, manifest});
            const slugs: Record<string, string> = {};
            for (const provider of marked.providers) slugs[provider] = await stack.slugOf(provider);
            const yaml = bindConnectionSlugs({yaml: marked.yaml, slugs});
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
