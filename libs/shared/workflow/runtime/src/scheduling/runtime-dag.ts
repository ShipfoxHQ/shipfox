export interface RuntimeDagNode {
  name: string;
  dependencies: readonly string[];
}

export type RuntimeCompletionStatus = 'succeeded' | 'failed';

/**
 * Returns nodes whose dependencies have all succeeded and that are not yet completed.
 */
export function findReadyNodes<T extends RuntimeDagNode>(
  nodes: readonly T[],
  completed: ReadonlyMap<string, RuntimeCompletionStatus>,
): T[] {
  return nodes.filter(
    (node) =>
      !completed.has(node.name) &&
      node.dependencies.every((dependency) => completed.get(dependency) === 'succeeded'),
  );
}

/**
 * Returns nodes that will never become ready because at least one dependency failed.
 */
export function findBlockedNodes<T extends RuntimeDagNode>(
  nodes: readonly T[],
  completed: ReadonlyMap<string, RuntimeCompletionStatus>,
): T[] {
  return nodes.filter(
    (node) =>
      !completed.has(node.name) &&
      node.dependencies.some((dependency) => completed.get(dependency) === 'failed'),
  );
}
