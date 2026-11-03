import type {AgentValidationCatalogV2} from '@shipfox/api-agent-dto/inter-module';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {issue} from './validation-issue.js';

/** The model fields an agent step and an agent file share. */
export interface AgentModelSelection {
  harness?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
}

export interface ValidateAgentModelSelectionParams {
  selection: AgentModelSelection;
  /** Where the selection sits in its document. `provider` and `model` are appended to it. */
  path: readonly WorkflowModelValidationIssuePathSegment[];
  issues: WorkflowModelValidationIssue[];
  validateLiteralModel: boolean;
  validateLiteralProvider: boolean;
  agentValidationCatalog: AgentValidationCatalogV2;
}

type AgentCatalogProvider = AgentValidationCatalogV2['providers'][number];

/**
 * Checks a provider and model against the catalog: the provider must be
 * supported by the harness, and a model the harness lists for the provider
 * must be one of its models. A locked model is a warning, never an error.
 */
export function validateAgentModelSelection(params: ValidateAgentModelSelectionParams): void {
  const providerId = params.selection.provider;
  const harness = params.selection.harness ?? params.agentValidationCatalog.default_harness_id;
  const provider =
    providerId === undefined
      ? undefined
      : params.agentValidationCatalog.providers.find((entry) => entry.id === providerId);

  if (!validateAgentProvider(params, providerId, harness, provider)) return;
  validateAgentModel(params, providerId, harness, provider);
}

function validateAgentProvider(
  params: ValidateAgentModelSelectionParams,
  providerId: string | undefined,
  harness: string | undefined,
  provider: AgentCatalogProvider | undefined,
): boolean {
  if (!params.validateLiteralProvider || providerId === undefined) return true;
  if (provider === undefined) {
    if (harness === undefined || harness === 'pi') return false;
    params.issues.push(
      issue({
        code: 'invalid-provider',
        message: `Provider "${providerId}" is not supported.`,
        path: [...params.path, 'provider'],
        details: {provider: providerId},
      }),
    );
    return false;
  }
  if (provider.support_status !== 'supported') {
    params.issues.push(
      issue({
        code: 'invalid-provider',
        message: `Provider "${providerId}" is not supported.`,
        path: [...params.path, 'provider'],
        details: {provider: providerId},
      }),
    );
    return false;
  }
  const descriptor = params.agentValidationCatalog.harnesses.find((entry) => entry.id === harness);
  if (descriptor?.supported_provider_ids.includes(providerId)) return true;
  params.issues.push(
    issue({
      code: 'harness-provider-incompatible',
      message: `Harness "${harness}" does not support provider: ${providerId}. Supported providers: ${descriptor?.supported_provider_ids.join(', ') ?? ''}.`,
      path: [...params.path, 'provider'],
      details: {
        harness,
        provider: providerId,
        supportedProviders: descriptor?.supported_provider_ids ?? [],
      },
    }),
  );
  return false;
}

function validateAgentModel(
  params: ValidateAgentModelSelectionParams,
  providerId: string | undefined,
  harness: string | undefined,
  provider: AgentCatalogProvider | undefined,
): void {
  if (!params.validateLiteralModel || providerId === undefined) return;
  if (provider === undefined || provider.support_status !== 'supported') return;

  const model = params.selection.model;
  if (model === undefined) return;

  const descriptor = params.agentValidationCatalog.harnesses.find((entry) => entry.id === harness);
  const modelIds = descriptor?.model_ids_by_provider?.[providerId];
  if (modelIds === undefined) return;
  if (modelIds.includes(model)) {
    warnWhenModelLocked(params, providerId, model);
    return;
  }

  params.issues.push(
    issue({
      code: 'invalid-model',
      message: `Agent model "${model}" is not available for harness "${harness}" and provider "${providerId}".`,
      path: [...params.path, 'model'],
      details: {harness, provider: providerId, model},
    }),
  );
}

// A warning, never an error: workspace limits change, so a locked model can be available again
// by the time the agent runs.
function warnWhenModelLocked(
  params: ValidateAgentModelSelectionParams,
  providerId: string,
  model: string,
): void {
  if (!params.agentValidationCatalog.locked_model_ids_by_provider?.[providerId]?.includes(model)) {
    return;
  }

  params.issues.push(
    issue({
      code: 'model-locked',
      message: `Model "${model}" is not available in this workspace. A step that uses it fails when it starts.`,
      path: [...params.path, 'model'],
      severity: 'warning',
      details: {provider: providerId, model},
    }),
  );
}
