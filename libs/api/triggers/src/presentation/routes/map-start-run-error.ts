import type {
  AgentConfigInvalidReason,
  AgentIntegrationMaterializationReason,
} from '@shipfox/api-workflows-dto';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError} from '@shipfox/node-fastify';

type StartRunMethod =
  | typeof workflowsInterModuleContract.methods.startRunFromTrigger
  | typeof workflowsInterModuleContract.methods.startDevRun;

export function mapStartRunError(error: unknown, method: StartRunMethod): ClientError | undefined {
  // Only trigger-started runs resolve a stored definition, so dev runs never raise these codes.
  if (isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, error)) {
    if (error.code === 'definition-not-found') {
      return new ClientError('Workflow definition not found', 'definition-not-found', {
        status: 404,
        cause: error,
      });
    }
    if (error.code === 'project-mismatch') {
      return new ClientError('Workflow definition belongs to another project', 'project-mismatch', {
        status: 409,
        cause: error,
      });
    }
  }
  if (!isInterModuleKnownError(method, error)) return undefined;

  switch (error.code) {
    case 'workspace-suspended':
      return new ClientError('Workspace is suspended', 'workspace-suspended', {
        status: 409,
        cause: error,
      });
    case 'workspace-deleted':
      return new ClientError('Workspace is deleted', 'workspace-deleted', {
        status: 404,
        cause: error,
      });
    case 'workspace-not-found':
      return new ClientError('Workspace not found', 'workspace-not-found', {
        status: 404,
        cause: error,
      });
    case 'admission-denied':
      return new ClientError('Workflow admission denied', 'admission-denied', {
        status: 409,
        details: {
          workspace_id: error.details.workspaceId,
          reason: error.details.reason,
          ...(error.details.requiredAction === undefined
            ? {}
            : {
                required_action: {
                  reason: error.details.requiredAction.reason,
                  message: error.details.requiredAction.message,
                  url: error.details.requiredAction.url,
                  ...(error.details.requiredAction.intent === undefined
                    ? {}
                    : {intent: error.details.requiredAction.intent}),
                },
              }),
        },
        cause: error,
      });
    case 'workflow-execution-payload-too-large':
      return new ClientError(
        'Workflow execution payload is too large',
        'workflow-execution-payload-too-large',
        {
          status: 422,
          details: {
            field: error.details.field,
            limit_bytes: error.details.limitBytes,
            measured_bytes: error.details.measuredBytes,
          },
          cause: error,
        },
      );
    case 'agent-config-unresolvable':
      return new ClientError(
        'Agent configuration cannot be resolved',
        'agent-config-unresolvable',
        {
          status: 422,
          details: agentConfigUnresolvableDetails(error.details),
          cause: error,
        },
      );
    case 'agent-integration-materialization-failed':
      return new ClientError(
        'Agent integration configuration cannot be materialized',
        'agent-integration-materialization-failed',
        {status: 422, details: agentIntegrationMaterializationDetails(error.details), cause: error},
      );
    case 'interpolation-unresolvable':
      return new ClientError(
        'Workflow interpolation cannot be resolved',
        'workflow-interpolation-unresolvable',
        {
          status: 422,
          details: interpolationUnresolvableDetails(error.details),
          cause: error,
        },
      );
    case 'invalid-job-runner-labels':
      return new ClientError(
        'Workflow requests invalid runner labels',
        'invalid-job-runner-labels',
        {
          status: 422,
          details: {labels: error.details.labels},
          cause: error,
        },
      );
    case 'source-snapshot-too-large':
      return new ClientError('Workflow source snapshot is too large', 'source-snapshot-too-large', {
        status: 422,
        details: {
          limit_bytes: error.details.limitBytes,
          measured_bytes: error.details.measuredBytes,
        },
        cause: error,
      });
    default:
      return undefined;
  }
}

function interpolationUnresolvableDetails(details: {
  field: string;
  source: string;
  envKey?: string | undefined;
  variableKey?: string | undefined;
  jobKey?: string | undefined;
  step?: {key?: string | undefined; name?: string | undefined; index: number} | undefined;
}) {
  return {
    field: details.field,
    source: details.source,
    ...(details.envKey === undefined ? {} : {env_key: details.envKey}),
    ...(details.variableKey === undefined ? {} : {variable_key: details.variableKey}),
    ...(details.jobKey === undefined ? {} : {job_key: details.jobKey}),
    ...(details.step === undefined ? {} : {step: details.step}),
  };
}

function agentConfigUnresolvableDetails(details: {
  definitionId: string;
  reason?: AgentConfigInvalidReason | undefined;
  model?: string | undefined;
  provider?: string | undefined;
  jobKey?: string | undefined;
  step?: {key?: string | undefined; name?: string | undefined; index: number} | undefined;
}) {
  return {
    definition_id: details.definitionId,
    ...(details.reason === undefined ? {} : {reason: details.reason}),
    ...(details.model === undefined ? {} : {model: details.model}),
    ...(details.provider === undefined ? {} : {provider: details.provider}),
    ...(details.jobKey === undefined ? {} : {job_key: details.jobKey}),
    ...(details.step === undefined ? {} : {step: details.step}),
  };
}

function agentIntegrationMaterializationDetails(details: {
  reason?: AgentIntegrationMaterializationReason | undefined;
  connection?: string | undefined;
  tool?: string | undefined;
  jobKey?: string | undefined;
  step?: {key?: string | undefined; name?: string | undefined; index: number} | undefined;
}) {
  return {
    ...(details.reason === undefined ? {} : {reason: details.reason}),
    ...(details.connection === undefined ? {} : {connection: details.connection}),
    ...(details.tool === undefined ? {} : {tool: details.tool}),
    ...(details.jobKey === undefined ? {} : {job_key: details.jobKey}),
    ...(details.step === undefined ? {} : {step: details.step}),
  };
}
