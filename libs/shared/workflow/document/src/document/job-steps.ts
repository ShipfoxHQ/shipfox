import {
  isWorkflowDocumentParallelBlock,
  type WorkflowDocumentJobStep,
  type WorkflowDocumentStep,
} from './workflow-document.js';

export interface WorkflowDocumentJobStepEntry {
  readonly step: WorkflowDocumentStep;
  /** Where the step sits in the job document, such as `['steps', 2, 'parallel', 1]`. */
  readonly path: readonly (string | number)[];
  /** The index in the job's `steps`. For a `parallel` member, the index of its block. */
  readonly index: number;
  /** The index inside the `parallel` block. Unset for a step outside a block. */
  readonly member?: number;
}

/**
 * Yields every step of a job in document order, `parallel` members included.
 * Walk a job's steps with it, never with `job.steps`, which also holds the
 * blocks.
 */
export function* jobSteps(job: {
  readonly steps: readonly WorkflowDocumentJobStep[];
}): Generator<WorkflowDocumentJobStepEntry> {
  for (const [index, entry] of job.steps.entries()) {
    if (!isWorkflowDocumentParallelBlock(entry)) {
      yield {step: entry, path: ['steps', index], index};
      continue;
    }
    for (const [member, step] of entry.parallel.entries()) {
      yield {step, path: ['steps', index, 'parallel', member], index, member};
    }
  }
}
