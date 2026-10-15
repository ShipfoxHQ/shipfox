import type {WorkflowDocument} from '@shipfox/workflow-document';
import {compositeActionUses, resolveCompositeUses} from './composite-action-references.js';
import type {ResolvedActions} from './entities/action-snapshot.js';

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

/**
 * The keys of every action a document reaches, its own `uses` first, then the
 * actions its composite actions use, in first-reach order.
 */
export function collectReachableActions(
  document: WorkflowDocument,
  actions: ResolvedActions,
): string[] {
  const reached = new Set<string>();
  const pending = collectActionReferences(document).reverse();
  while (pending.length > 0) {
    const key = pending.pop();
    if (key === undefined || reached.has(key)) continue;
    reached.add(key);
    const action = actions.get(key);
    if (action?.composite === undefined) continue;
    const inner = compositeActionUses(action.manifest).flatMap(({uses}) => {
      const result = resolveCompositeUses({
        uses,
        parentKey: key,
        parentIsRegistry: action.registry !== undefined,
      });
      return result.ok ? [result.key] : [];
    });
    for (const innerKey of inner.reverse()) pending.push(innerKey);
  }
  return [...reached];
}
