import {appendLogsResponseSchema, offsetGapResponseSchema} from '@shipfox/api-logs-dto';
import {claimedJobResponseSchema, heartbeatResponseSchema} from '@shipfox/api-runners-dto';
import {
  checkoutTokenResponseSchema,
  nextStepResponseSchema,
  reportStepBodySchema,
  reportStepResponseSchema,
} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError} from 'ky';
import {
  JobLeaseNotFoundError,
  type LeaseProtocol,
  type RunnerProtocol,
  StepReportRejectedError,
} from '#contract.js';

const STEP_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Media type the append endpoint expects for the raw NDJSON request body. */
const LOG_NDJSON_CONTENT_TYPE = 'application/x-ndjson';

/**
 * Builds the real {@link RunnerProtocol} over `ky`. Pure: takes the base URL and
 * runner token as arguments rather than reading configuration, so the harness can
 * point it anywhere and importing it never validates the runner's environment.
 * The configured default lives in `default-client.ts`.
 */
export function createProtocolClient(params: {
  baseUrl: string;
  runnerToken: string;
}): RunnerProtocol {
  const baseUrl = params.baseUrl.endsWith('/') ? params.baseUrl : `${params.baseUrl}/`;

  // Runner token (long-lived) authes claim + heartbeat; step calls use a per-job lease token.
  const api = ky.create({
    baseUrl,
    headers: {Authorization: `Bearer ${params.runnerToken}`},
  });

  return {
    // Scheduling is step-less: the claim returns only the job/run ids and the lease
    // token. Steps are pulled one at a time from the step API using that token.
    async requestJob(options = {}) {
      logger().debug('Polling for job');

      const response = await api.post(
        'runners/jobs/request',
        options.signal ? {signal: options.signal} : undefined,
      );

      if (response.status === 204) {
        return null;
      }

      return claimedJobResponseSchema.parse(await response.json());
    },

    async heartbeat(jobId, options = {}) {
      try {
        const response = await api.post(
          `runners/jobs/${jobId}/heartbeat`,
          options.signal ? {signal: options.signal} : undefined,
        );
        return heartbeatResponseSchema.parse(await response.json());
      } catch (error) {
        throw mapLeaseError(error);
      }
    },

    forJob(leaseToken) {
      return createLeaseProtocol(baseUrl, leaseToken);
    },
  };
}

function createLeaseProtocol(baseUrl: string, leaseToken: string): LeaseProtocol {
  // next/report are idempotent, so we widen ky's retry to POST (off by default): a lost
  // response is retried in place, never re-pulling or re-executing a step. 404/409 are not
  // retried — they surface as typed errors so the loop can stop.
  const leaseClient = ky.create({
    baseUrl,
    headers: {Authorization: `Bearer ${leaseToken}`},
    retry: {
      methods: ['post'],
      statusCodes: [408, 429, 500, 502, 503, 504],
    },
  });

  return {
    async requestNextStep(options = {}) {
      try {
        const response = await leaseClient.post(
          'runs/jobs/current/steps/next',
          options.signal ? {signal: options.signal} : undefined,
        );
        return nextStepResponseSchema.parse(await response.json());
      } catch (error) {
        throw mapLeaseError(error);
      }
    },

    async reportStep(params) {
      const body = reportStepBodySchema.parse({
        status: params.status,
        error: params.error ?? undefined,
        attempt: params.attempt,
        exit_code: params.exitCode,
      });

      try {
        const response = await leaseClient.post(`runs/jobs/current/steps/${params.stepId}/report`, {
          json: body,
          ...(params.signal ? {signal: params.signal} : {}),
        });
        return reportStepResponseSchema.parse(await response.json());
      } catch (error) {
        throw mapReportError(error);
      }
    },

    // The job is identified by the lease claims, so no id is sent. The raw HTTPError is
    // left to propagate (no mapLeaseError): the setup step classifies a checkout failure
    // by HTTP status and provider error code. Retries ride the leaseClient policy, each
    // re-minting a fresh short-lived credential.
    async requestCheckoutToken(options = {}) {
      const response = await leaseClient.post(
        'runs/jobs/current/checkout-token',
        options.signal ? {signal: options.signal} : undefined,
      );
      return checkoutTokenResponseSchema.parse(await response.json());
    },

    // throwHttpErrors:false turns off ky's status-code retry for this call, so no HTTP
    // status is retried in-transport (only network/timeout errors are). Every status is
    // mapped explicitly: 409 and the terminal 4xx to outcomes, 5xx/unknown to a thrown
    // error the uploader retries on its next tick.
    async appendStepLogs(params) {
      if (!STEP_ID_PATTERN.test(params.stepId)) {
        throw new Error(`Invalid step id for log append: ${params.stepId}`);
      }

      // throwHttpErrors:false so we can read the 409 body ourselves (ky discards it when it
      // builds an HTTPError). It also disables ky's status-code retry, so 5xx is not retried
      // in-transport and falls through to the throw below.
      const response = await leaseClient.post(`runs/jobs/current/steps/${params.stepId}/logs`, {
        body: params.body,
        headers: {'content-type': LOG_NDJSON_CONTENT_TYPE},
        searchParams: {attempt: params.attempt, offset: params.offset},
        throwHttpErrors: false,
        ...(params.signal ? {signal: params.signal} : {}),
      });

      if (response.ok) {
        const {committed_length, capped} = appendLogsResponseSchema.parse(await response.json());
        return {status: 'committed', committedLength: committed_length, capped};
      }
      if (response.status === 409) {
        const {details} = offsetGapResponseSchema.parse(await response.json());
        return {status: 'conflict', committedLength: details.committed_length};
      }
      // Any other 4xx is permanent for this request: the endpoint is gone (deploy skew), the
      // lease is rejected (401/403), or the body will never be accepted (400/413/415/422).
      // Re-sending the identical body cannot succeed, so stop and let the server's stream
      // lifecycle close it. 408/429 are transient and fall through to the retry path.
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429
      ) {
        return {status: 'stopped'};
      }
      // 5xx, 408, 429, or any other unexpected status: throw so the uploader logs it and
      // retries on the next tick (throwHttpErrors disables ky's in-transport status retry).
      throw new Error(`Log append failed with status ${response.status}`);
    },
  };
}

// A 404 on a lease-authed call means orchestration finalized the job server-side.
function mapLeaseError(error: unknown): unknown {
  if (error instanceof HTTPError && error.response.status === 404) {
    return new JobLeaseNotFoundError();
  }
  return error;
}

// Report adds 409 (step not running / attempt ahead) on top of the 404 lease-gone case.
function mapReportError(error: unknown): unknown {
  if (error instanceof HTTPError) {
    if (error.response.status === 404) return new JobLeaseNotFoundError();
    if (error.response.status === 409) return new StepReportRejectedError();
  }
  return error;
}
