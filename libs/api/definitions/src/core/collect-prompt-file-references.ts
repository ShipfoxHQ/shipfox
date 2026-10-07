import type {WorkflowDocument} from '@shipfox/workflow-document';

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
  const references: PromptFileReference[] = [];
  for (const [jobName, job] of Object.entries(document.jobs)) {
    for (const [stepIndex, step] of job.steps.entries()) {
      if (!Array.isArray(step.prompt)) continue;
      for (const [partIndex, part] of step.prompt.entries()) {
        if (typeof part === 'string') continue;
        references.push({
          file: part.file,
          path: `jobs.${jobName}.steps.${stepIndex}.prompt.${partIndex}`,
        });
      }
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
