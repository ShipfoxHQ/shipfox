import type {ClaimedJobResponseDto, HeartbeatResponseDto} from '@shipfox/api-runners-dto';
import type {
  CheckoutTokenResponseDto,
  NextStepResponseDto,
  ReportStepResponseDto,
  StepErrorDtoShape,
} from '@shipfox/api-workflows-dto';

/**
 * The runner-facing result of one log append, after the transport has interpreted the
 * HTTP status. `committed` carries the new server offset (and whether the budget is now
 * exhausted); `conflict` carries the offset to rewind/fast-forward to; `stopped` means
 * the endpoint is gone or the lease is no longer accepted, so the uploader gives up.
 */
export type LogAppendOutcome =
  | {status: 'committed'; committedLength: number; capped: boolean}
  | {status: 'conflict'; committedLength: number}
  | {status: 'stopped'};

/**
 * The append port the runner's log uploader depends on. The caller binds the lease,
 * step, and attempt; the uploader only supplies the offset and body.
 */
export type LogAppendFn = (args: {
  offset: number;
  body: Uint8Array;
  signal?: AbortSignal;
}) => Promise<LogAppendOutcome>;

/**
 * The per-job protocol surface, bound to a single lease token. Hides the
 * underlying HTTP client so orchestration depends on this interface rather than
 * a `ky` instance, which lets tests drive the runner with an in-memory fake.
 */
export interface LeaseProtocol {
  requestNextStep(options?: {signal?: AbortSignal}): Promise<NextStepResponseDto>;
  reportStep(params: {
    stepId: string;
    attempt: number;
    status: 'succeeded' | 'failed';
    error?: StepErrorDtoShape;
    exitCode: number | null;
    signal?: AbortSignal;
  }): Promise<ReportStepResponseDto>;
  // Exchanges the lease for short-lived, read-only repository checkout credentials. The
  // raw HTTP error is left unmapped (unlike next/report's 404/409 typing) because the
  // setup step classifies checkout failures by HTTP status and provider error code.
  requestCheckoutToken(options?: {signal?: AbortSignal}): Promise<CheckoutTokenResponseDto>;
  // Appends one chunk of captured step output. Interprets the HTTP status into a
  // {@link LogAppendOutcome} (committed / conflict / stopped) rather than throwing on 4xx,
  // so the uploader can pace, rewind, or give up; only 5xx / unexpected statuses throw.
  appendStepLogs(params: {
    stepId: string;
    attempt: number;
    offset: number;
    body: Uint8Array;
    signal?: AbortSignal;
  }): Promise<LogAppendOutcome>;
}

/**
 * The runner's full protocol surface. {@link createProtocolClient} returns the
 * real implementation that talks to the API; tests inject an in-memory fake that
 * implements the same shape.
 *
 * `requestJob` takes a signal so a hung claim can be aborted by the poll-loop
 * shutdown rather than wedging the runner.
 */
export interface RunnerProtocol {
  requestJob(options?: {signal?: AbortSignal}): Promise<ClaimedJobResponseDto | null>;
  heartbeat(jobId: string, options?: {signal?: AbortSignal}): Promise<HeartbeatResponseDto>;
  forJob(leaseToken: string): LeaseProtocol;
}

/**
 * The lease no longer resolves to a live job: a next-step or heartbeat call
 * returned 404 because orchestration finalized the job server-side. Orchestration
 * branches on this typed error instead of an HTTP status, so a 404 never leaks as
 * a raw transport error.
 */
export class JobLeaseNotFoundError extends Error {
  constructor(message = 'Job lease not found') {
    super(message);
    this.name = 'JobLeaseNotFoundError';
  }
}

/**
 * The server rejected a step report as out of date (409): the step is no longer
 * running, or the reported attempt is stale. The job bails and the lease expires
 * server-side rather than the runner retrying a superseded attempt.
 */
export class StepReportRejectedError extends Error {
  constructor(message = 'Step report rejected') {
    super(message);
    this.name = 'StepReportRejectedError';
  }
}
