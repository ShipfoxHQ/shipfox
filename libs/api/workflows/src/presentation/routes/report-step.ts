import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {
  type ReportStepBodyDto,
  reportStepBodySchema,
  reportStepResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  StepAttemptAheadError,
  StepNotFoundError,
  StepNotRunningError,
  StepNotStoppingError,
} from '#core/errors.js';
import {confirmStepStopped, recordStepResult} from '#core/job-execution.js';
import {fromStepErrorDto} from '#presentation/dto/step.js';

// The runner stopped a step that a cancel step cancelled. The report names the attempt it was
// dispatched.
function confirmStop(params: {
  jobExecutionId: string;
  stepId: string;
  body: ReportStepBodyDto;
  output: Record<string, unknown> | null;
}) {
  const {body} = params;
  // The body schema requires the attempt of a cancelled report.
  if (body.attempt === undefined) {
    throw new ClientError('A cancelled report names its attempt', 'attempt-required', {
      status: 400,
    });
  }
  return confirmStepStopped({
    jobExecutionId: params.jobExecutionId,
    stepId: params.stepId,
    attempt: body.attempt,
    output: params.output,
    response: body.response ?? null,
    exitCode: body.exit_code ?? null,
    logPath: body.log_path ?? null,
    logOutcome: body.log_outcome,
  });
}

// Checkout is a reserved system field on the report wire contract. Keep it out of the runner's
// user output merge until this persistence boundary, where the system value has explicit precedence.
function reportedOutput(body: ReportStepBodyDto): Record<string, unknown> | null {
  return body.checkout === undefined
    ? (body.output ?? null)
    : {...(body.output ?? {}), checkout: body.checkout};
}

function recordResult(params: {
  jobExecutionId: string;
  stepId: string;
  status: 'succeeded' | 'failed';
  body: ReportStepBodyDto;
  output: Record<string, unknown> | null;
}) {
  const {body} = params;
  return recordStepResult({
    jobExecutionId: params.jobExecutionId,
    stepId: params.stepId,
    status: params.status,
    error: fromStepErrorDto(body.error),
    output: params.output,
    response: body.response ?? null,
    exitCode: body.exit_code ?? body.error?.exit_code ?? null,
    ...(body.log_path === undefined ? {} : {logPath: body.log_path}),
    ...(body.actions_dir === undefined ? {} : {actionsDir: body.actions_dir}),
    logOutcome: body.log_outcome,
    ...(body.attempt !== undefined ? {attempt: body.attempt} : {}),
  });
}

export function createReportStepRoute(runners: RunnersInterModuleClient) {
  return defineRoute({
    method: 'POST',
    path: '/steps/:stepId/report',
    description:
      'Reports whether a step succeeded, failed, or, for a step that a cancel step is stopping, was cancelled. A cancelled report confirms that the step process exited. The job is identified by the access token. Reporting the same step more than once is safe: once a step has finished, later reports for it are ignored. The runner does not call a separate job-completion endpoint: finalization is driven server-side from the recorded step results, and the `cancel` flag tells the runner to stop once the job has finished without full success.',
    schema: {
      params: z.object({stepId: z.string().uuid()}),
      body: reportStepBodySchema,
      response: {
        200: reportStepResponseSchema,
      },
    },
    errorHandler: (error) => {
      if (error instanceof StepNotFoundError) {
        throw new ClientError(error.message, 'step-not-found', {status: 404});
      }
      if (error instanceof StepNotRunningError) {
        throw new ClientError(error.message, 'step-not-running', {status: 409});
      }
      if (error instanceof StepNotStoppingError) {
        throw new ClientError(error.message, 'step-not-stopping', {status: 409});
      }
      if (error instanceof StepAttemptAheadError) {
        throw new ClientError(error.message, 'step-attempt-ahead', {status: 409});
      }
      throw error;
    },
    handler: async (request) => {
      const {stepId} = request.params;
      const leasedJob = requireLeasedJobContext(request);

      const {active: leaseIsActive} = await runners.getLeaseState({
        jobId: leasedJob.jobId,
        jobExecutionId: leasedJob.jobExecutionId,
        runnerSessionId: leasedJob.runnerSessionId,
      });
      if (!leaseIsActive) {
        throw new ClientError('Job lease is no longer active', 'lease-not-active', {status: 404});
      }

      const {status} = request.body;
      const reported = {
        jobExecutionId: leasedJob.jobExecutionId,
        stepId,
        body: request.body,
        output: reportedOutput(request.body),
      };
      const outcome =
        status === 'cancelled'
          ? await confirmStop(reported)
          : await recordResult({...reported, status});

      return {ok: true, cancel: outcome.jobFinished && outcome.status === 'failed'};
    },
  });
}
