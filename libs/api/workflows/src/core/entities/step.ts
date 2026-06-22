export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

// A step_attempts row exists only once an attempt is dispatched, so it is never
// 'pending'.
export type StepAttemptStatus = Exclude<StepStatus, 'pending'>;

export interface Step {
  id: string;
  jobId: string;
  name: string | null;
  status: StepStatus;
  type: string;
  config: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  position: number;
  version: number;
  // Execution-attempt identity for the current projection: which attempt the
  // status/output/error above reflect. Distinct from `version` (the optimistic
  // row counter). Starts at 1 and is bumped when a step is rewound.
  currentAttempt: number;
  createdAt: Date;
  updatedAt: Date;
}

// Append-only execution history: one row per dispatched attempt of a step. The
// current projection lives on `Step`; this is the audit trail and the
// idempotency anchor (unique on (stepId, attempt)).
export interface StepAttempt {
  id: string;
  stepId: string;
  jobId: string;
  attempt: number;
  status: StepAttemptStatus;
  output: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  exitCode: number | null;
  gateResult: Record<string, unknown> | null;
  restartReason: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;
}
