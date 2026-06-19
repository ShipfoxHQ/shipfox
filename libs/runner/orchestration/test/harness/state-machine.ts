import {randomUUID} from 'node:crypto';
import type {ClaimedJobResponseDto} from '@shipfox/api-runners-dto';
import {
  type CheckoutTokenResponseDto,
  type NextStepResponseDto,
  type ReportStepResponseDto,
  reportStepBodySchema,
  type StepDto,
  type StepErrorDtoShape,
} from '@shipfox/api-workflows-dto';
import {
  JobLeaseNotFoundError,
  type LogAppendOutcome,
  StepReportRejectedError,
} from '@shipfox/runner-protocol/contract';

/**
 * A simplified, in-memory model of the server's step state machine, used to drive
 * the real runner through whole workflows without a live API.
 *
 * It mirrors the LINEAR subset of `libs/api/workflows/src/core/job-execution.ts`
 * and `step-transition/*`: position-ordered dispatch, idempotent re-delivery of the
 * running step, single-attempt reporting, cancel-on-failure, and
 * all-succeeded-or-failed completion.
 *
 * It deliberately does NOT model gates, restart/rewind, multi-attempt history,
 * outbox finalization, runner-token scoping, lease rows, or DB concurrency. It is
 * a control-flow test double, not a server replacement. See README.md.
 */

export interface RunStepSpec {
  name?: string;
  run: string;
}

export interface WorkflowSpec {
  steps: RunStepSpec[];
  /** Prepend the synthetic position-0 setup step every real job gets. Default true. */
  autoSetup?: boolean;
  /** heartbeat resolves with {cancel: true}. */
  cancelOnHeartbeat?: boolean;
  /** heartbeat throws JobLeaseNotFoundError (the orphaned-job path). */
  finalizeOnHeartbeat?: boolean;
  /** requestNextStep throws JobLeaseNotFoundError (lease vanished mid-loop). */
  failNextStep?: boolean;
  /** reportStep throws StepReportRejectedError (stale / not-running). */
  failReport?: boolean;
  /** How many times requestJob throws before succeeding (poll-loop backoff path). */
  failClaims?: number;
  /** How many jobs requestJob serves before returning null. Default 1. */
  jobsToServe?: number;
  /**
   * The checkout token the fake returns for the setup step's requestCheckoutToken.
   * Required when the setup step runs (the real setup step clones it), so integration
   * tests that drive a job through setup must point this at a cloneable repo.
   */
  checkout?: CheckoutTokenResponseDto;
}

export interface ReportRecord {
  stepId: string;
  attempt: number;
  status: 'succeeded' | 'failed';
  error: StepErrorDtoShape | undefined;
  exitCode: number | null;
}

type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface StepRecord {
  id: string;
  name: string | null;
  type: 'setup' | 'run';
  config: Record<string, unknown>;
  position: number;
  status: StepStatus;
  currentAttempt: number;
}

interface ReportParams {
  stepId: string;
  attempt: number;
  status: 'succeeded' | 'failed';
  error?: StepErrorDtoShape | undefined;
  exitCode: number | null;
}

const TERMINAL: ReadonlySet<StepStatus> = new Set(['succeeded', 'failed', 'cancelled']);

export class WorkflowStateMachine {
  readonly jobId = randomUUID();
  readonly runId = randomUUID();
  private readonly leaseToken = `lease-${randomUUID()}`;
  private readonly steps: StepRecord[];
  private claimsRemaining: number;
  private claimErrorsRemaining: number;
  private readonly spec: WorkflowSpec;

  readonly claims: ClaimedJobResponseDto[] = [];
  readonly nextDispatched: string[] = [];
  readonly reports: ReportRecord[] = [];
  readonly heartbeats: string[] = [];
  readonly logAppends: Array<{stepId: string; attempt: number; offset: number; length: number}> =
    [];

  constructor(spec: WorkflowSpec) {
    this.spec = spec;
    const autoSetup = spec.autoSetup ?? true;
    const runSteps = spec.steps.map((s) => ({
      type: 'run' as const,
      name: s.name ?? null,
      config: {run: s.run} as Record<string, unknown>,
    }));
    const all = autoSetup
      ? [
          {type: 'setup' as const, name: 'Set up job', config: {} as Record<string, unknown>},
          ...runSteps,
        ]
      : runSteps;
    this.steps = all.map((s, position) => ({
      id: randomUUID(),
      name: s.name,
      type: s.type,
      config: s.config,
      position,
      status: 'pending',
      currentAttempt: 1,
    }));
    this.claimsRemaining = spec.jobsToServe ?? 1;
    this.claimErrorsRemaining = spec.failClaims ?? 0;
  }

  requestJob(): ClaimedJobResponseDto | null {
    if (this.claimErrorsRemaining > 0) {
      this.claimErrorsRemaining -= 1;
      throw new Error('Simulated transient claim failure');
    }
    if (this.claimsRemaining <= 0) return null;
    this.claimsRemaining -= 1;
    const claim: ClaimedJobResponseDto = {
      job_id: this.jobId,
      run_id: this.runId,
      lease_token: this.leaseToken,
    };
    this.claims.push(claim);
    return claim;
  }

  heartbeat(jobId: string): {cancel: boolean} {
    this.heartbeats.push(jobId);
    if (this.spec.finalizeOnHeartbeat) throw new JobLeaseNotFoundError();
    return {cancel: this.spec.cancelOnHeartbeat ?? false};
  }

  nextStep(leaseToken: string): NextStepResponseDto {
    this.assertLease(leaseToken);
    if (this.spec.failNextStep) throw new JobLeaseNotFoundError();

    const running = this.steps.find((s) => s.status === 'running');
    if (running) {
      this.nextDispatched.push(running.id);
      return {kind: 'step', step: toDto(running, this.jobId), attempt: running.currentAttempt};
    }

    const pending = this.steps.find((s) => s.status === 'pending');
    if (pending) {
      pending.status = 'running';
      this.nextDispatched.push(pending.id);
      return {kind: 'step', step: toDto(pending, this.jobId), attempt: pending.currentAttempt};
    }

    return {kind: 'done', status: this.deriveCompletion()};
  }

  reportStep(leaseToken: string, params: ReportParams): ReportStepResponseDto {
    this.assertLease(leaseToken);
    if (this.spec.failReport) throw new StepReportRejectedError();

    // Validate the payload exactly as the real client would, so a malformed runner
    // shape (e.g. succeeded-with-error) fails here instead of passing green.
    reportStepBodySchema.parse({
      status: params.status,
      error: params.error ?? undefined,
      attempt: params.attempt,
      exit_code: params.exitCode,
    });

    const step = this.steps.find((s) => s.id === params.stepId);
    // Unknown step id is a 404 on the wire (StepNotFoundError), which the client maps to
    // JobLeaseNotFoundError, not the 409 StepReportRejectedError. Mirror what the loop sees.
    if (!step) throw new JobLeaseNotFoundError(`Unknown step ${params.stepId}`);

    // Idempotency guards mirroring job-execution.ts.
    if (params.attempt > step.currentAttempt) {
      throw new StepReportRejectedError('Reported attempt is ahead of dispatch');
    }
    if (params.attempt < step.currentAttempt || TERMINAL.has(step.status)) {
      return this.outcome();
    }
    if (step.status === 'pending') {
      throw new StepReportRejectedError('Step is not running');
    }

    step.status = params.status;
    this.reports.push({
      stepId: params.stepId,
      attempt: params.attempt,
      status: params.status,
      error: params.error,
      exitCode: params.exitCode,
    });

    if (params.status === 'failed') {
      for (const other of this.steps) {
        if (!TERMINAL.has(other.status)) other.status = 'cancelled';
      }
    }

    return this.outcome();
  }

  checkoutToken(leaseToken: string): CheckoutTokenResponseDto {
    this.assertLease(leaseToken);
    if (!this.spec.checkout) {
      throw new Error('WorkflowSpec.checkout is required to run a job through the setup step');
    }
    return this.spec.checkout;
  }

  // Accepts every append and commits the whole body — enough to keep the real log
  // uploader advancing so run steps drain cleanly. It does not model the offset-gap
  // (409) or capped paths; those stay covered by protocol-client.test.ts.
  appendStepLogs(
    leaseToken: string,
    params: {stepId: string; attempt: number; offset: number; body: Uint8Array},
  ): LogAppendOutcome {
    this.assertLease(leaseToken);
    this.logAppends.push({
      stepId: params.stepId,
      attempt: params.attempt,
      offset: params.offset,
      length: params.body.length,
    });
    return {
      status: 'committed',
      committedLength: params.offset + params.body.length,
      capped: false,
    };
  }

  /** Position-ordered snapshot of step state for assertions. */
  snapshot(): Array<{position: number; type: 'setup' | 'run'; status: StepStatus; id: string}> {
    return this.steps.map((s) => ({
      position: s.position,
      type: s.type,
      status: s.status,
      id: s.id,
    }));
  }

  private assertLease(leaseToken: string): void {
    if (leaseToken !== this.leaseToken) {
      throw new JobLeaseNotFoundError(`Unknown lease token: ${leaseToken}`);
    }
  }

  private outcome(): ReportStepResponseDto {
    const finished = this.steps.every((s) => TERMINAL.has(s.status));
    const status = this.deriveCompletion();
    return {ok: true, cancel: finished && status === 'failed'};
  }

  private deriveCompletion(): 'succeeded' | 'failed' {
    return this.steps.every((s) => s.status === 'succeeded') ? 'succeeded' : 'failed';
  }
}

function toDto(step: StepRecord, jobId: string): StepDto {
  return {
    id: step.id,
    job_id: jobId,
    name: step.name,
    status: step.status,
    type: step.type,
    config: step.config,
    error: null,
    position: step.position,
    current_attempt: step.currentAttempt,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}
