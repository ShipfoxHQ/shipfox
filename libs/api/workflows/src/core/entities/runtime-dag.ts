export type RuntimeCompletionStatus = 'succeeded' | 'failed';

export interface RuntimeDagJob {
  readonly id: string;
  readonly name: string;
  readonly dependencies: readonly string[];
  readonly version: number;
}
