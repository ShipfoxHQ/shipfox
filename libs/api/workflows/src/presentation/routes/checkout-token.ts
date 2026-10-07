import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
  repositoryAuthorizationErrorCodes,
} from '@shipfox/api-integration-core-dto/inter-module';
import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {
  checkoutTokenBodySchema,
  checkoutTokenParamsSchema,
  checkoutTokenQuerySchema,
  checkoutTokenResponseSchema,
} from '@shipfox/api-workflows-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {captureException} from '@shipfox/node-error-monitoring';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {
  createStepCheckoutSpec,
  getCheckoutPolicy,
  renewStepCheckoutCredentials,
  repositoryNameFromUrl,
} from '#core/checkout.js';
import {warnRenewableGitCapabilityMismatchOnDispatch} from '#core/checkout-capability-warning.js';
import type {CheckoutRenewalSubject} from '#core/entities/checkout-renewal-subject.js';
import type {StepStatus} from '#core/entities/step.js';
import {
  CheckoutConfigInvalidError,
  type CheckoutFailureTarget,
  CheckoutIntentUnresolvedError,
  CheckoutRepositoryUrlInvalidError,
} from '#core/errors.js';
import {savePendingCheckoutRenewalSubject} from '#db/checkout-renewal-subjects.js';
import {recordWorkflowCheckoutTokenRequest} from '#metrics/instance.js';
import {toCheckoutTokenDto, toCheckoutTokenRenewalDto} from '#presentation/dto/checkout-token.js';
import {
  assertLeasedJobActive,
  type LoadedRunningLeasedStep,
  loadRunningLeasedStep,
} from './leased-step.js';

export function createCheckoutTokenRoute(clients: {
  annotations: AnnotationsInterModuleClient;
  runners: RunnersInterModuleClient;
  integrations: IntegrationsModuleClient;
  projects: ProjectsModuleClient;
}) {
  return defineRoute({
    method: 'POST',
    path: '/steps/:stepId/checkout-token',
    description:
      "Exchanges the runner's lease for short-lived checkout credentials for a current checkout step or a successful persisted checkout attempt. The step id and attempt are checked against the lease and all repository scope is supplied by server-owned state; a renewal may report only the rejected credential generation.",
    schema: {
      params: checkoutTokenParamsSchema,
      querystring: checkoutTokenQuerySchema,
      body: checkoutTokenBodySchema.nullish(),
      response: {200: checkoutTokenResponseSchema},
    },
    errorHandler: handleCheckoutTokenError,
    handler: async (request, reply) => {
      const hasRejectedGeneration = request.body?.rejected_generation !== undefined;
      const failure: CheckoutFailureTarget = {};
      let mode: 'initial' | 'initial-replacement' | 'renewal' = 'initial';
      try {
        const {stepId} = request.params;
        const {attempt} = request.query;
        const loaded = await loadRunningLeasedStep({
          runners: clients.runners,
          request,
          stepId,
          attempt,
          allowSuccessfulPersistedCheckout: true,
          allowInitialCheckoutCredentialReplacement: hasRejectedGeneration,
        });

        mode = checkoutTokenRequestMode({
          hasRejectedGeneration,
          stepStatus: loaded.step.status,
          hasRenewalSubject: loaded.checkoutRenewalSubject !== undefined,
        });

        if (loaded.step.type !== 'setup' && loaded.step.type !== 'checkout') {
          throw new ClientError('Step is not a checkout step', 'step-not-checkout', {status: 409});
        }
        if (hasRejectedGeneration && loaded.checkoutRenewalSubject === undefined) {
          throw new ClientError(
            'The checkout credential replacement scope is unavailable',
            'checkout-renewal-unavailable',
            {status: 409},
          );
        }

        const response = await createCheckoutTokenResponse({
          clients,
          loaded,
          stepId,
          attempt,
          rejectedGeneration: request.body?.rejected_generation,
          failure,
          warn: (context, message) => request.log.warn(context, message),
          error: (context, message) => request.log.error(context, message),
        });
        if (response.auth?.persist === true) {
          await warnRenewableGitCapabilityMismatchOnDispatch({
            annotations: clients.annotations,
            runners: clients.runners,
            leaseIdentity: loaded.leasedJob,
            step: loaded.step,
          });
        }
        recordWorkflowCheckoutTokenRequest(mode, 'success');
        reply.header('cache-control', 'no-store');
        return response;
      } catch (error) {
        recordWorkflowCheckoutTokenRequest(mode, 'failure');
        throw await translateCheckoutTokenError(error, failure, clients.integrations);
      }
    },
  });
}

async function createCheckoutTokenResponse(params: {
  clients: Parameters<typeof createCheckoutTokenRoute>[0];
  loaded: LoadedRunningLeasedStep;
  stepId: string;
  attempt: number;
  rejectedGeneration?: string | undefined;
  failure: CheckoutFailureTarget;
  warn: (context: {outcome: string}, message: string) => void;
  error: (context: {outcome: string}, message: string) => void;
}): Promise<ReturnType<typeof toCheckoutTokenDto>> {
  await assertLeasedJobActive(params.clients.runners, params.loaded.leasedJob);

  if (params.loaded.checkoutRenewalSubject !== undefined) {
    params.failure.connectionId = params.loaded.checkoutRenewalSubject.connectionId;
    params.failure.repository = repositoryNameFromUrl(
      params.loaded.checkoutRenewalSubject.repositoryUrl,
    );
    const credentials = await renewStepCheckoutCredentials({
      integrations: params.clients.integrations,
      workspaceId: params.loaded.workspaceId,
      subject: params.loaded.checkoutRenewalSubject,
      ...(params.rejectedGeneration === undefined
        ? {}
        : {rejectedGeneration: params.rejectedGeneration}),
    });
    await assertLeasedJobActive(params.clients.runners, params.loaded.leasedJob);
    return toCheckoutTokenRenewalDto(
      params.loaded.checkoutRenewalSubject.repositoryUrl,
      credentials,
      {persist: getCheckoutPolicy(params.loaded.step.config)?.persistCredentials ?? false},
    );
  }

  const checkout = await createStepCheckoutSpec({
    step: params.loaded.step,
    workspaceId: params.loaded.workspaceId,
    projectId: params.loaded.projectId,
    triggerReference: params.loaded.triggerReference,
    run: params.loaded.run,
    integrations: params.clients.integrations,
    projects: params.clients.projects,
    failure: params.failure,
  });
  await assertLeasedJobActive(params.clients.runners, params.loaded.leasedJob);
  const response = toCheckoutTokenDto(checkout.spec, {
    fetchDepth: checkout.fetchDepth,
    persist: checkout.persistCredentials,
  });
  if (checkout.renewalSubject !== undefined) {
    const subjectSaved = await persistCheckoutRenewalSubject({
      renewalSubject: checkout.renewalSubject,
      stepId: params.stepId,
      attempt: params.attempt,
      jobExecutionId: params.loaded.step.jobExecutionId,
      workflowRunAttemptId: params.loaded.leasedJob.workflowRunAttemptId,
      warn: params.warn,
      error: params.error,
    });
    if (!subjectSaved && response.auth !== undefined) response.auth.persist = false;
  }
  return response;
}

async function persistCheckoutRenewalSubject(params: {
  renewalSubject: Omit<CheckoutRenewalSubject, 'stepId' | 'attempt'>;
  stepId: string;
  attempt: number;
  jobExecutionId: string;
  workflowRunAttemptId: string;
  warn: (context: {outcome: string}, message: string) => void;
  error: (context: {outcome: string}, message: string) => void;
}): Promise<boolean> {
  try {
    const subjectSaved = await savePendingCheckoutRenewalSubject({
      ...params.renewalSubject,
      stepId: params.stepId,
      attempt: params.attempt,
      jobExecutionId: params.jobExecutionId,
      workflowRunAttemptId: params.workflowRunAttemptId,
    });
    if (subjectSaved) return true;
    params.warn(
      {outcome: 'checkout-renewal-subject-not-saved'},
      'Checkout credentials will not be persisted',
    );
    return false;
  } catch (error) {
    params.error(
      {outcome: 'checkout-renewal-subject-save-failed'},
      'Checkout renewal subject could not be saved',
    );
    captureException(error);
    return false;
  }
}

function checkoutTokenRequestMode(params: {
  hasRejectedGeneration: boolean;
  stepStatus: StepStatus;
  hasRenewalSubject: boolean;
}): 'initial' | 'initial-replacement' | 'renewal' {
  if (params.hasRejectedGeneration && params.stepStatus === 'running') {
    return 'initial-replacement';
  }
  return params.hasRenewalSubject ? 'renewal' : 'initial';
}

function handleCheckoutTokenError(error: unknown): never {
  throw mapCheckoutTokenError(error, {});
}

async function translateCheckoutTokenError(
  error: unknown,
  failure: CheckoutFailureTarget,
  integrations: Pick<IntegrationsModuleClient, 'resolveConnectionById'>,
): Promise<unknown> {
  const target = isIntegrationCheckoutFailure(error)
    ? await withConnectionSlug(failure, integrations)
    : failure;
  return mapCheckoutTokenError(error, target);
}

// Only these failures name the connection, so only they pay for the slug lookup.
function isIntegrationCheckoutFailure(error: unknown): boolean {
  return (
    isInterModuleKnownError(integrationsInterModuleContract.methods.createCheckoutSpec, error) ||
    isInterModuleKnownError(
      integrationsInterModuleContract.methods.createCheckoutCredentials,
      error,
    )
  );
}

async function withConnectionSlug(
  target: CheckoutFailureTarget,
  integrations: Pick<IntegrationsModuleClient, 'resolveConnectionById'>,
): Promise<CheckoutFailureTarget> {
  if (target.connection !== undefined || target.connectionId === undefined) return target;
  try {
    const connection = await integrations.resolveConnectionById({
      connectionId: target.connectionId,
    });
    return connection === null ? target : {...target, connection: connection.slug};
  } catch {
    // The slug only improves the message; the original failure is what matters.
    return target;
  }
}

function mapCheckoutTokenError(error: unknown, target: CheckoutFailureTarget): unknown {
  if (error instanceof CheckoutIntentUnresolvedError) {
    return new ClientError(unresolvedCheckoutMessage(error), 'checkout-unavailable', {
      details: {[error.kind]: error.value},
      status: 404,
    });
  }
  if (error instanceof CheckoutRepositoryUrlInvalidError) {
    return new ClientError(
      'Checkout repository URL is invalid',
      'checkout-repository-url-invalid',
      {
        status: 422,
        cause: error,
      },
    );
  }
  if (error instanceof CheckoutConfigInvalidError) {
    return new ClientError('Checkout configuration is invalid', 'checkout-config-invalid', {
      status: 409,
    });
  }
  if (
    isInterModuleKnownError(projectsInterModuleContract.methods.resolveCheckoutTarget, error) &&
    error.code === 'checkout-repository-not-authorized'
  ) {
    return new ClientError(
      `Shipfox isn't allowed to check out the repository of project \`${target.project ?? 'unknown'}\`: the project doesn't belong to this workspace`,
      'checkout-repository-not-authorized',
      {details: {project: target.project}, status: 404},
    );
  }
  if (
    isInterModuleKnownError(integrationsInterModuleContract.methods.createCheckoutSpec, error) ||
    isInterModuleKnownError(
      integrationsInterModuleContract.methods.createCheckoutCredentials,
      error,
    )
  ) {
    return integrationCheckoutError(error as unknown as IntegrationCheckoutKnownError, target);
  }
  return error;
}

function unresolvedCheckoutMessage(error: CheckoutIntentUnresolvedError): string {
  return error.kind === 'connection'
    ? `Checkout connection \`${error.value}\` doesn't exist in this workspace`
    : `Checkout project \`${error.value}\` no longer exists`;
}

interface IntegrationCheckoutKnownError {
  code: string;
  details?: unknown;
}

interface ProviderFailureDetails {
  reason: string;
  retryAfterSeconds?: number;
  providerMessage?: string;
  providerStatus?: number;
}

function integrationCheckoutError(
  error: IntegrationCheckoutKnownError,
  target: CheckoutFailureTarget,
): unknown {
  const targetDetails = {repository: target.repository, connection: target.connection};
  const repository =
    target.repository === undefined ? 'the repository' : `\`${target.repository}\``;
  const connection =
    target.connection === undefined ? 'the connection' : `connection \`${target.connection}\``;
  switch (error.code) {
    case 'connection-not-found':
      return new ClientError(
        'Integration connection not found',
        'integration-connection-not-found',
        {status: 404},
      );
    case 'connection-inactive':
      return new ClientError(
        'Integration connection is not active',
        'integration-connection-inactive',
        {status: 422},
      );
    case 'connection-workspace-mismatch':
      return new ClientError(
        'Integration connection does not belong to this workspace',
        'forbidden',
        {status: 403},
      );
    case 'provider-unavailable':
      return new ClientError(
        'Integration provider is unavailable',
        'integration-provider-unavailable',
        {status: 422},
      );
    case 'capability-unavailable':
      return new ClientError(
        'Integration capability is unavailable',
        'integration-capability-unavailable',
        {status: 422},
      );
    case 'checkout-unsupported':
      return new ClientError(
        'Integration checkout is unsupported',
        'integration-checkout-unsupported',
        {status: 422},
      );
    case 'provider-failure':
      return providerFailureError(
        error.details as ProviderFailureDetails,
        connection,
        targetDetails,
      );
    case repositoryAuthorizationErrorCodes.required:
      return new ClientError(
        `Checkout on ${connection} needs a repository, written as owner/name`,
        repositoryAuthorizationErrorCodes.required,
        {details: targetDetails, status: 422},
      );
    case repositoryAuthorizationErrorCodes.notGranted:
      return new ClientError(
        `Shipfox isn't allowed to check out ${repository}: no project in this workspace is linked to it, and ${connection} doesn't allow all repositories`,
        repositoryAuthorizationErrorCodes.notGranted,
        {details: targetDetails, status: 404},
      );
    case repositoryAuthorizationErrorCodes.ambiguous:
      return new ClientError(
        `More than one project is linked to ${repository} on ${connection}, so Shipfox can't tell which one authorizes the checkout`,
        repositoryAuthorizationErrorCodes.ambiguous,
        {details: targetDetails, status: 409},
      );
    case repositoryAuthorizationErrorCodes.storeUnavailable:
      return new ClientError(
        'Repository authorization is unavailable',
        repositoryAuthorizationErrorCodes.storeUnavailable,
        {status: 503},
      );
    case repositoryAuthorizationErrorCodes.targetInvalid:
      return new ClientError(
        'Checkout repository target is invalid',
        repositoryAuthorizationErrorCodes.targetInvalid,
        {status: 409},
      );
    default:
      return error;
  }
}

function providerFailureError(
  details: ProviderFailureDetails,
  connection: string,
  targetDetails: {repository: string | undefined; connection: string | undefined},
): ClientError {
  const message =
    details.reason === 'installation-inactive'
      ? `The GitHub App installation for ${connection} is suspended or removed`
      : 'Integration provider request failed';
  return new ClientError(message, details.reason, {
    details: {
      ...targetDetails,
      retry_after_seconds: details.retryAfterSeconds,
      provider_message: details.providerMessage,
      provider_status: details.providerStatus,
    },
    status: providerFailureStatus(details.reason),
  });
}

function providerFailureStatus(reason: string): 422 | 429 | 503 {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}
