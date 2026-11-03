import {
  type ActionManifest,
  actionPathRelativePart,
  isCompositeActionManifest,
  jobSteps,
  type WorkflowDocument,
  type WorkflowDocumentStep,
} from '@shipfox/workflow-document';

export interface PromptFileReference {
  /** The `file` path as written in the YAML. */
  file: string;
  /** Where the part sits, for example `jobs.review.steps.4.prompt.2`, or `jobs.review.steps.4.parallel.1.prompt.2` in a `parallel` block. */
  path: string;
}

/**
 * The `file` parts of every agent prompt, in document order. The same file can
 * appear more than once, one entry for each part that names it.
 */
export function collectPromptFileReferences(document: WorkflowDocument): PromptFileReference[] {
  return Object.entries(document.jobs).flatMap(([jobName, job]) =>
    stepPromptFileReferences(
      [...jobSteps(job)].map(({step, path}) => ({step, path: `jobs.${jobName}.${path.join('.')}`})),
    ),
  );
}

/**
 * The repository `file` parts of a composite action's steps, with paths such
 * as `steps.2.prompt.0`. Parts that start with `${{ action.path }}/` read the
 * action's own files and are left out.
 */
export function collectCompositePromptFileReferences(
  manifest: ActionManifest,
): PromptFileReference[] {
  if (!isCompositeActionManifest(manifest)) return [];
  return stepPromptFileReferences(
    manifest.steps.map((step, index) => ({step, path: `steps.${index}`})),
  ).filter((reference) => actionPathRelativePart(reference.file) === undefined);
}

function stepPromptFileReferences(
  steps: readonly {step: WorkflowDocumentStep; path: string}[],
): PromptFileReference[] {
  return steps.flatMap(({step, path}) =>
    step.prompt === undefined ? [] : promptFileReferences(step.prompt, `${path}.prompt`),
  );
}

/** A prompt as the document holds it: a string, or a list of strings and `file` parts. */
export type DocumentPrompt = string | readonly (string | {readonly file: string})[];

/** The `file` parts of one prompt. `path` is where the prompt sits, and parts add their index. */
export function promptFileReferences(prompt: DocumentPrompt, path: string): PromptFileReference[] {
  if (typeof prompt === 'string') return [];
  return prompt.flatMap((part, partIndex) =>
    typeof part === 'string' ? [] : [{file: part.file, path: `${path}.${partIndex}`}],
  );
}

/** The distinct `file` paths of a document, sorted. */
export function collectPromptFilePaths(document: WorkflowDocument): string[] {
  return [
    ...new Set(collectPromptFileReferences(document).map((reference) => reference.file)),
  ].sort();
}
