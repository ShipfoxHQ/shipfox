export type RuntimeCompletionStatus = 'succeeded' | 'failed';

export interface RuntimeDagNode {
  readonly id: string;
  readonly name: string;
  readonly dependencies: readonly string[];
  readonly version: number;
}
