import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {boundedMap} from '@shipfox/node-module';
import type {WorkflowDocument} from '@shipfox/workflow-document';
import {collectPromptFileReferences} from './collect-prompt-file-references.js';
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

export interface ResolvePromptFilesParams extends PromptFileSourceContext {
  workflows: readonly {path: string; document: WorkflowDocument}[];
}

/**
 * Reads every prompt file the workflows name, once per path. A file that is
 * missing, empty, or not readable text fails with the first part that names it.
 */
export async function resolvePromptFiles(
  params: ResolvePromptFilesParams,
): Promise<Map<string, string>> {
  const firstUse = new Map<string, {path: string; filePath: string}>();
  for (const workflow of params.workflows) {
    for (const reference of collectPromptFileReferences(workflow.document)) {
      if (!firstUse.has(reference.file)) {
        firstUse.set(reference.file, {path: reference.path, filePath: workflow.path});
      }
    }
  }

  const entries = await boundedMap(
    [...firstUse],
    FILE_FETCH_CONCURRENCY,
    async ([file, use]) => [file, await readPromptFile({...params, file, ...use})] as const,
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
