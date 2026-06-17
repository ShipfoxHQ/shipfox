/**
 * Per-job accrual-budget state: how many stored bytes a job has used, the budget
 * clock origin, and whether it has been capped.
 */
export interface JobAccounting {
  jobId: string;
  workspaceId: string;
  storedBytesUsed: number;
  startedAt: Date;
  cappedAt: Date | null;
}
