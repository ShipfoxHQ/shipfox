import type {WorkflowDocument} from '@shipfox/workflow-document';

/**
 * The distinct `uses` paths of a document, in first-use order. Action steps
 * cannot sit inside `parallel` or `background` groups, so top-level steps
 * cover every reference.
 */
export function collectActionReferences(document: WorkflowDocument): string[] {
  const paths = new Set<string>();
  for (const job of Object.values(document.jobs)) {
    for (const step of job.steps) {
      if (step.uses !== undefined) paths.add(step.uses);
    }
  }
  return [...paths];
}
