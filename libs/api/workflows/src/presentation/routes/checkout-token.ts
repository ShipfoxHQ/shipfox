import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import {integrationRouteErrorHandler} from '@shipfox/api-integration-core';
import {checkoutTokenResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {createJobCheckoutSpec} from '#core/checkout.js';
import {
  CheckoutIntentUnresolvedError,
  JobNotActiveError,
  JobNotFoundError,
  WorkflowRunNotFoundError,
} from '#core/errors.js';
import {sourceControl} from '#core/source-control.js';
import {toCheckoutTokenDto} from '#presentation/dto/checkout-token.js';

export const checkoutTokenRoute = defineRoute({
  method: 'POST',
  path: '/checkout-token',
  description:
    "Exchanges the runner's job lease for short-lived, read-only checkout credentials for the job's repository. The job is identified by the access token, so no job ID is needed. The checkout target is resolved server-side from the job's run and project; no credential material is stored on the job or run. Returns the repository URL, ref, and (when the provider needs auth) a short-lived credential that expires soon.",
  schema: {
    response: {
      200: checkoutTokenResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof JobNotFoundError) {
      throw new ClientError(error.message, 'job-not-found', {status: 404});
    }
    if (error instanceof JobNotActiveError) {
      throw new ClientError(error.message, 'job-not-active', {status: 409});
    }
    if (error instanceof WorkflowRunNotFoundError) {
      throw new ClientError(error.message, 'run-not-found', {status: 404});
    }
    if (error instanceof CheckoutIntentUnresolvedError) {
      throw new ClientError(error.message, 'checkout-unavailable', {status: 404});
    }
    // Connection and provider errors (and the structural provider-error detection)
    // map through the shared handler, which re-throws unknowns to the global handler.
    return integrationRouteErrorHandler(error);
  },
  handler: async (request, reply) => {
    const leasedJob = requireLeasedJobContext(request);

    const spec = await createJobCheckoutSpec({
      jobId: leasedJob.jobId,
      sourceControl: sourceControl(),
    });

    // The body carries short-lived git credentials; forbid any intermediary or
    // client cache from retaining them.
    reply.header('cache-control', 'no-store');
    return toCheckoutTokenDto(spec);
  },
});
