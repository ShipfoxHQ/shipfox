import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {boundedMap} from '@shipfox/node-module';
import type {WorkflowDocument} from '@shipfox/workflow-document';
import {
  collectCompositePromptFileReferences,
  collectPromptFileReferences,
} from './collect-prompt-file-references.js';
import type {ResolvedActions} from './entities/action-snapshot.js';
import {PromptFileResolutionError} from './errors.js';
import {
  type DefinitionsSourceControl,
  FILE_FETCH_CONCURRENCY,
  isBinaryFileError,
} from './integrations.js';

export interface PromptFileSourceContext {
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  sourceControl: Pick<DefinitionsSourceControl, 'fetchFile'>;
  /** Commit SHA, so every prompt file is read from the same tree as the workflows. */
  ref: string;
}

/** One `file` prompt part: the file it names, where the part sits, and the file that holds it. */
export interface PromptFileUse {
  /** The `file` path as written in the YAML. */
  file: string;
  /** Where the part sits in its document, for example `jobs.review.steps.4.prompt.2`. */
  path: string;
  /** The repository file that holds the part. */
  filePath: string;
}

export interface ResolvePromptFilesParams extends PromptFileSourceContext {
  /** Every `file` part to read. A file named more than once is read once. */
  references: readonly PromptFileUse[];
}

/**
 * The `file` parts of the workflows and of the composite actions they use,
 * in document order.
 */
export function collectWorkflowPromptFileUses(params: {
  workflows: readonly {path: string; document: WorkflowDocument}[];
  actions?: ResolvedActions | undefined;
}): PromptFileUse[] {
  const uses: PromptFileUse[] = [];
  for (const workflow of params.workflows) {
    for (const reference of collectPromptFileReferences(workflow.document)) {
      uses.push({...reference, filePath: workflow.path});
    }
  }
  for (const action of params.actions?.values() ?? []) {
    if (action.composite === undefined) continue;
    for (const reference of collectCompositePromptFileReferences(action.manifest)) {
      uses.push({...reference, filePath: action.composite.manifestPath});
    }
  }
  return uses;
}

/**
 * Reads every repository prompt file the references name, once per path. A
 * file that is missing, empty, or not readable text fails with the first part
 * that names it.
 */
export async function resolvePromptFiles(
  params: ResolvePromptFilesParams,
): Promise<Map<string, string>> {
  const firstUse = new Map<string, PromptFileUse>();
  for (const use of params.references) {
    if (!firstUse.has(use.file)) firstUse.set(use.file, use);
  }

  const entries = await boundedMap(
    [...firstUse.values()],
    FILE_FETCH_CONCURRENCY,
    async (use) => [use.file, await readPromptFile({...params, ...use})] as const,
    {stopOnError: true},
  );
  return new Map(entries);
}

async function readPromptFile(
  params: PromptFileSourceContext & {file: string; path: string; filePath: string},
): Promise<string> {
  const fail = (reason: string) =>
    new PromptFileResolutionError(
      `Prompt file "${params.file}" at ${params.path} ${reason}`,
      params.path,
      params.filePath,
    );

  let content: string;
  try {
    const snapshot = await params.sourceControl.fetchFile({
      workspaceId: params.workspaceId,
      connectionId: params.sourceConnectionId,
      externalRepositoryId: params.sourceExternalRepositoryId,
      ref: params.ref,
      path: params.file.slice('./'.length),
    });
    content = snapshot.content;
  } catch (error) {
    if (isBinaryFileError(error)) throw fail('is not UTF-8 text.');
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.fetchSourceFile, error)) {
      if (error.code === 'provider-failure' && error.details.reason === 'file-not-found') {
        throw fail('was not found at this commit.');
      }
      if (error.code === 'provider-failure' && error.details.reason === 'content-too-large') {
        throw fail('is too large.');
      }
    }
    throw error;
  }

  if (content.trim() === '') throw fail('is empty.');
  return content;
}
