import type {StepSourceFile, StepSourceLocation} from './entities/step.js';

export const WORKFLOW_SOURCE_FILENAME = 'workflow.yaml';

const TRAILING_SLASHES = /\/+$/u;

interface CompositeTreeStep {
  id: string;
  parentStepId?: string | undefined;
}

/**
 * The composite steps that hold `stepId`, outermost first. The chain stops at a parent that is
 * not in `steps`, so a partly loaded step page still yields the nearest known ancestors.
 */
export function compositeAncestors<T extends CompositeTreeStep>(
  steps: readonly T[],
  stepId: string,
): T[] {
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const ancestors: T[] = [];
  const visited = new Set<string>([stepId]);
  let parentId = stepById.get(stepId)?.parentStepId;
  while (parentId !== undefined && !visited.has(parentId)) {
    const parent = stepById.get(parentId);
    if (!parent) break;
    visited.add(parentId);
    ancestors.unshift(parent);
    parentId = parent.parentStepId;
  }
  return ancestors;
}

/** The file a source location points into, named the way an author finds it. */
export function sourceFileLabel(file: StepSourceFile | undefined): string {
  if (!file) return WORKFLOW_SOURCE_FILENAME;
  return `${file.uses.replace(TRAILING_SLASHES, '')}/${file.path}`;
}

export function sourceLinesLabel(location: Pick<StepSourceLocation, 'startLine' | 'endLine'>) {
  return location.startLine === location.endLine
    ? String(location.startLine)
    : `${location.startLine}-${location.endLine}`;
}

/** The resolved non-secret inputs a composite attempt recorded when it opened. */
export function compositeAttemptInputs(
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const inputs = config?.inputs;
  return inputs !== null && typeof inputs === 'object' && !Array.isArray(inputs)
    ? (inputs as Record<string, unknown>)
    : {};
}
