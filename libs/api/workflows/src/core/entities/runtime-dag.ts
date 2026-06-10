export type RuntimeCompletionStatus = 'succeeded' | 'failed';

export interface RuntimeDagStep {
  readonly id: string;
  readonly name: string | null;
  readonly type: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly position: number;
}

export interface RuntimeDagJob {
  readonly id: string;
  readonly name: string;
  readonly dependencies: readonly string[];
  readonly version: number;
  readonly steps: readonly RuntimeDagStep[];
}
