import {type PolicyNotice, policyNoticeSchema} from '@shipfox/policy-notice';
import type {AgentThinking} from '@shipfox/workflow-document';
import {z} from 'zod';
import {type CustomAgentModelDto, customAgentModelSchema} from './custom-model-provider.js';
import {modelPriceSchema, modelReferencesSchema} from './model-reference.js';
import {managedModelCompatSchema, managedModelThinkingLevelMapSchema} from './pi-model.js';

export {
  type ManagedModelCompat,
  type ManagedModelThinkingLevel,
  type ManagedModelThinkingLevelMap,
  managedModelCompatSchema,
  managedModelThinkingLevelMapSchema,
  managedModelThinkingLevelSchema,
} from './pi-model.js';

export const managedModelApiSchema = z.enum([
  'anthropic-messages',
  'openai-responses',
  'openai-completions',
]);

export type ManagedModelApi = z.infer<typeof managedModelApiSchema>;

export const managedProviderJobIdentitySchema = z.object({
  projectId: z.string().uuid(),
  workflowRunAttemptId: z.string().uuid(),
  jobId: z.string().uuid(),
  jobExecutionId: z.string().uuid(),
  stepId: z.string().uuid(),
  attempt: z.number().int().positive(),
});

export type ManagedProviderJobIdentity = z.infer<typeof managedProviderJobIdentitySchema>;

/** Stable provider error code for a runner that cannot use renewable inference credentials. */
export const RUNNER_CAPABILITY_REQUIRED_ERROR_CODE = 'runner-capability-required';

/** Stable provider error code for a managed model that the workspace may not use. */
export const MODEL_UNAVAILABLE_ERROR_CODE = 'agent-model-unavailable';

export const modelUnavailableDetailsSchema = z.object({
  model: z.string().min(1),
  notice: policyNoticeSchema,
});

export type ModelUnavailableDetails = z.infer<typeof modelUnavailableDetailsSchema>;

export const managedModelMetadataSchema = customAgentModelSchema
  .omit({
    id: true,
    label: true,
    thinking_level_map: true,
    compat: true,
  })
  .extend({
    claudeModelId: z.string().min(1).max(128).optional(),
    lab: z.string().min(1).optional(),
    price: modelPriceSchema.optional(),
    references: modelReferencesSchema.optional(),
    thinkingLevelMap: managedModelThinkingLevelMapSchema.optional(),
    thinking_level_map: managedModelThinkingLevelMapSchema.optional(),
    compat: managedModelCompatSchema.optional(),
  })
  .superRefine((model, ctx) => {
    if (model.thinkingLevelMap !== undefined && model.thinking_level_map !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['thinkingLevelMap'],
        message: 'Use either thinkingLevelMap or thinking_level_map, not both.',
      });
    }
  });

export type ManagedModelMetadata = z.infer<typeof managedModelMetadataSchema>;

/**
 * Optional model metadata passed through to Pi's custom-provider adapter.
 * Omitted properties retain the adapter's defaults.
 */
export interface ManagedModelEntry extends Readonly<ManagedModelMetadata> {
  readonly id: string;
  readonly label: string;
  readonly api: ManagedModelApi;
}

export function toCustomAgentModelDto(
  model: Pick<ManagedModelEntry, 'id' | 'label'> & ManagedModelMetadata,
): CustomAgentModelDto {
  const {
    claudeModelId: _claudeModelId,
    price: _price,
    references: _references,
    lab: _lab,
    thinkingLevelMap,
    thinking_level_map,
    ...metadata
  } = managedModelMetadataSchema.parse(model);
  const normalizedThinkingLevelMap = thinkingLevelMap ?? thinking_level_map;

  return {
    id: model.id,
    label: model.label,
    ...metadata,
    ...(normalizedThinkingLevelMap === undefined
      ? {}
      : {thinking_level_map: normalizedThinkingLevelMap}),
  };
}

/**
 * Lease-scoped credentials and endpoint returned by a managed provider.
 *
 * `baseUrl` is the provider's gateway mount root, including any deployment
 * path prefix but not a client-specific API path, query, or fragment. The
 * agent runtime normalizes this root for the client API family before handing
 * it to a harness client.
 */
export interface ManagedProviderRuntimeConfig {
  readonly api: ManagedModelApi;
  /** Gateway mount root, including path prefixes but no client API path, query, or fragment. */
  readonly baseUrl: string;
  readonly credentials: Record<string, string>;
  readonly expiresAt?: Date | undefined;
  readonly generation?: string | undefined;
  readonly renewal?:
    | {readonly mode: 'refresh-at'; readonly refreshAt: Date}
    | {readonly mode: 'on-rejection'}
    | undefined;
}

export interface ManagedModelLock {
  /** Badge text, for example `Add credits to use`. */
  readonly label: string;
  readonly notice: PolicyNotice;
}

/** Thrown by the agent module when a managed provider locks the requested model. */
export class ManagedModelUnavailableError extends Error {
  readonly code = MODEL_UNAVAILABLE_ERROR_CODE;
  readonly model: string;
  readonly notice: PolicyNotice;

  constructor(model: string, notice: PolicyNotice) {
    super(notice.message);
    this.name = 'ManagedModelUnavailableError';
    this.model = model;
    this.notice = notice;
  }
}

export interface ManagedModelProvider {
  readonly id: string;
  readonly label: string;
  readonly models: readonly ManagedModelEntry[];
  readonly defaultModel: string;
  readonly defaultThinking?: AgentThinking | undefined;
  /**
   * Locked models for one workspace. Models not in the map are available.
   *
   * Checked before the first `resolveCredentials` of a step attempt and never on renewal, so a
   * running step is not cut off. A model in the returned map fails the step with a 422 and its
   * notice. A rejection is reported as a retryable 503.
   *
   * The lock is a product limit, not a security boundary: the runner marks renewals with a
   * request header, so a caller that sets it can skip the check.
   */
  readonly availability?:
    | ((params: {workspaceId: string}) => Promise<ReadonlyMap<string, ManagedModelLock>>)
    | undefined;
  /**
   * Resolves credentials for one leased step attempt.
   *
   * Reject with an `Error` carrying `RUNNER_CAPABILITY_REQUIRED_ERROR_CODE` when renewable
   * credentials require runner support that the claim-time capability snapshot does not provide.
   */
  readonly resolveCredentials: (params: {
    workspaceId: string;
    runId: string;
    stepAttemptId: string;
    /** Complete job identity supplied by the leased workflow step when available. */
    jobIdentity?: ManagedProviderJobIdentity | undefined;
    model: string;
    renewableInference: boolean;
  }) => Promise<ManagedProviderRuntimeConfig>;
}
