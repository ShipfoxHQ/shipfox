export type RuntimeCompletionStatus = 'succeeded' | 'failed' | 'cancelled' | 'skipped';

export interface RuntimeDagNode {
  readonly id: string;
  readonly key: string;
  readonly mode: 'one_shot' | 'listening';
  readonly dependencies: readonly string[];
  readonly hasActivationCondition?: boolean | undefined;
  readonly version: number;
}
