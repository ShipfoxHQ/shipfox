import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {checkoutTokenResponseSchema} from '@shipfox/api-workflows-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {createJobCheckoutSpec} from '#core/checkout.js';
import {
  CheckoutIntentUnresolvedError,
  JobNotFoundError,
  WorkflowRunNotFoundError,
} from '#core/errors.js';
import {toCheckoutTokenDto} from '#presentation/dto/checkout-token.js';

export function createCheckoutTokenRoute(clients: {
  runners: RunnersInterModuleClient;
  integrations: IntegrationsModuleClient;
  projects: ProjectsModuleClient;
}) {
  return defineRoute({
    method: 'POST',
    path: '/checkout-token',
    description:
      "Exchanges the runner's job lease for short-lived, read-only checkout credentials for the job's repository. The job is identified by the access token, so no job ID is needed. The checkout target is resolved server-side from the job's run and project; no credential material is stored on the job or run. Returns the repository URL, ref, and (when the provider needs auth) a short-lived credential that expires soon.",
    schema: {response: {200: checkoutTokenResponseSchema}},
    errorHandler: (error) => {
      const known = isInterModuleKnownError(
        integrationsInterModuleContract.methods.createCheckoutSpec,
        error,
      )
        ? error
        : undefined;
      if (error instanceof JobNotFoundError)
        throw new ClientError(error.message, 'job-not-found', {status: 404});
      if (error instanceof WorkflowRunNotFoundError)
        throw new ClientError(error.message, 'run-not-found', {status: 404});
      if (error instanceof CheckoutIntentUnresolvedError)
        throw new ClientError(error.message, 'checkout-unavailable', {status: 404});
      if (known?.code === 'connection-not-found')
        throw new ClientError(
          'Integration connection not found',
          'integration-connection-not-found',
          {
            status: 404,
          },
        );
      if (known?.code === 'connection-inactive')
        throw new ClientError(
          'Integration connection is not active',
          'integration-connection-inactive',
          {
            status: 422,
          },
        );
      if (known?.code === 'connection-workspace-mismatch')
        throw new ClientError(
          'Integration connection does not belong to this workspace',
          'forbidden',
          {status: 403},
        );
      if (known?.code === 'provider-unavailable')
        throw new ClientError(
          'Integration provider is unavailable',
          'integration-provider-unavailable',
          {
            status: 422,
          },
        );
      if (known?.code === 'capability-unavailable')
        throw new ClientError(
          'Integration capability is unavailable',
          'integration-capability-unavailable',
          {
            status: 422,
          },
        );
      if (known?.code === 'checkout-unsupported')
        throw new ClientError(
          'Integration checkout is unsupported',
          'integration-checkout-unsupported',
          {
            status: 422,
          },
        );
      if (known?.code === 'provider-failure') {
        const status =
          known.details.reason === 'rate-limited'
            ? 429
            : known.details.reason === 'timeout' || known.details.reason === 'provider-unavailable'
              ? 503
              : 422;
        throw new ClientError('Integration provider request failed', known.details.reason, {
          details: {retry_after_seconds: known.details.retryAfterSeconds},
          status,
        });
      }
      throw error;
    },
    handler: async (request, reply) => {
      const leasedJob = requireLeasedJobContext(request);
      const {active: leaseIsActive} = await clients.runners.getLeaseState({
        jobId: leasedJob.jobId,
        jobExecutionId: leasedJob.jobExecutionId,
        runnerSessionId: leasedJob.runnerSessionId,
      });
      if (!leaseIsActive)
        throw new ClientError('Job lease is no longer active', 'lease-not-active', {status: 404});
      const checkout = await createJobCheckoutSpec({
        jobId: leasedJob.jobId,
        integrations: clients.integrations,
        projects: clients.projects,
      });
      reply.header('cache-control', 'no-store');
      return toCheckoutTokenDto(checkout.spec, {persist: checkout.persistCredentials});
    },
  });
}
