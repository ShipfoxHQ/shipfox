export type RuntimeCompletionStatus = 'succeeded' | 'failed';

export interface RuntimeDagNode {
  readonly id: string;
  readonly key: string;
  readonly mode: 'one_shot' | 'listening';
  readonly dependencies: readonly string[];
  readonly version: number;
}
