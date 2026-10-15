import {
  type ActionManifest,
  actionPathRelativePart,
  isCompositeActionManifest,
  type WorkflowDocument,
  type WorkflowDocumentStep,
} from '@shipfox/workflow-document';

export interface PromptFileReference {
  /** The `file` path as written in the YAML. */
  file: string;
  /** Where the part sits, for example `jobs.review.steps.4.prompt.2`. */
  path: string;
}

/**
 * The `file` parts of every agent prompt, in document order. The same file can
 * appear more than once, one entry for each part that names it.
 */
export function collectPromptFileReferences(document: WorkflowDocument): PromptFileReference[] {
  return Object.entries(document.jobs).flatMap(([jobName, job]) =>
    stepPromptFileReferences(job.steps, `jobs.${jobName}.steps`),
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
  return stepPromptFileReferences(manifest.steps, 'steps').filter(
    (reference) => actionPathRelativePart(reference.file) === undefined,
  );
}

function stepPromptFileReferences(
  steps: readonly WorkflowDocumentStep[],
  stepsPath: string,
): PromptFileReference[] {
  const references: PromptFileReference[] = [];
  for (const [stepIndex, step] of steps.entries()) {
    if (!Array.isArray(step.prompt)) continue;
    for (const [partIndex, part] of step.prompt.entries()) {
      if (typeof part === 'string') continue;
      references.push({file: part.file, path: `${stepsPath}.${stepIndex}.prompt.${partIndex}`});
    }
  }
  return references;
}

/** The distinct `file` paths of a document, sorted. */
export function collectPromptFilePaths(document: WorkflowDocument): string[] {
  return [
    ...new Set(collectPromptFileReferences(document).map((reference) => reference.file)),
  ].sort();
}
