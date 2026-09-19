import {createHash, randomUUID} from 'node:crypto';
import {
  AGENT_ACCESS_ERROR_DETAIL_STRING_MAX_BYTES,
  AGENT_ACCESS_ERROR_DETAILS_MAX_BYTES,
  agentAccessOutputSchema,
  cancelWorkflowRunInputJsonSchema,
  cancelWorkflowRunInputSchema,
  cancelWorkflowRunResultJsonSchema,
  cancelWorkflowRunResultSchema,
  createDevRunInputJsonSchema,
  createDevRunInputSchema,
  createDevRunResultJsonSchema,
  createDevRunResultSchema,
  fireManualTriggerInputJsonSchema,
  fireManualTriggerInputSchema,
  fireManualTriggerResultJsonSchema,
  fireManualTriggerResultSchema,
  rerunWorkflowRunInputJsonSchema,
  rerunWorkflowRunInputSchema,
  rerunWorkflowRunResultJsonSchema,
  rerunWorkflowRunResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {TriggersInterModuleClient} from '@shipfox/api-triggers-dto/inter-module';
import {triggersInterModuleContract} from '@shipfox/api-triggers-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {agentAccessError, agentAccessSuccess} from './envelope.js';
import {truncateAgentAccessUtf8} from './response.js';
import {invalidRequest, optionalField, parseInput} from './tool-utils.js';
import type {AgentAccessTool} from './tools.js';

export interface AgentAccessActionToolsOptions {
  workflows: WorkflowsModuleClient;
  triggers: TriggersInterModuleClient;
}

const AGENT_ACCESS_ERROR_DETAILS_RESERVE_BYTES = 128;
const AGENT_ACCESS_ERROR_LIST_BUDGET_BYTES =
  AGENT_ACCESS_ERROR_DETAILS_MAX_BYTES - AGENT_ACCESS_ERROR_DETAILS_RESERVE_BYTES;
const utf8Encoder = new TextEncoder();

/** Creates the action tools without registering them in the production tool list. */
export function createAgentAccessActionTools(
  options: AgentAccessActionToolsOptions,
): readonly AgentAccessTool[] {
  return [
    createCancelWorkflowRunTool(options.workflows),
    createRerunWorkflowRunTool(options.workflows),
    createFireManualTriggerTool(options.triggers),
    createDevRunTool(options.triggers),
  ];
}

function createCancelWorkflowRunTool(workflows: WorkflowsModuleClient): AgentAccessTool {
  return {
    name: 'cancel_workflow_run',
    description:
      'Cancel the current attempt of a workflow run. expected_attempt is required and protects against cancelling a newer attempt. A retry after a successful cancel returns run-already-finished with details.status; cancelled means the requested outcome already holds, while another terminal status means the run finished before cancellation.',
    inputSchema: cancelWorkflowRunInputJsonSchema,
    outputSchema: agentAccessOutputSchema(cancelWorkflowRunResultJsonSchema),
    validateInput: (input) => cancelWorkflowRunInputSchema.safeParse(input).success,
    validateResult: (result) => cancelWorkflowRunResultSchema.safeParse(result).success,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: async ({context, arguments: rawInput}) => {
      const input = parseInput(cancelWorkflowRunInputSchema, rawInput);
      if (!input) return invalidRequest();

      try {
        const result = await workflows.cancelWorkflowRun({
          workspaceId: context.workspaceId,
          workflowRunId: input.run_id,
          expectedAttempt: input.expected_attempt,
        });
        return agentAccessSuccess({
          run_id: result.id,
          workflow_run_attempt: result.currentAttempt,
          status: result.status,
        });
      } catch (error) {
        if (
          isInterModuleKnownError(workflowsInterModuleContract.methods.cancelWorkflowRun, error)
        ) {
          return mapProducerError(error.code, error.details);
        }
        throw error;
      }
    },
  };
}

function createRerunWorkflowRunTool(workflows: WorkflowsModuleClient): AgentAccessTool {
  return {
    name: 'rerun_workflow_run',
    description:
      'Rerun a terminal workflow run. expected_attempt is required and identifies the source attempt; mode is required and must be all or failed. If a retry after success returns attempt-mismatch with details.current_attempt, the rerun already happened. Do not retry based only on run-not-terminal because the new attempt can finish before the retry.',
    inputSchema: rerunWorkflowRunInputJsonSchema,
    outputSchema: agentAccessOutputSchema(rerunWorkflowRunResultJsonSchema),
    validateInput: (input) => rerunWorkflowRunInputSchema.safeParse(input).success,
    validateResult: (result) => rerunWorkflowRunResultSchema.safeParse(result).success,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    execute: async ({context, arguments: rawInput}) => {
      const input = parseInput(rerunWorkflowRunInputSchema, rawInput);
      if (!input) return invalidRequest();

      try {
        const result = await workflows.rerunWorkflowRun({
          workspaceId: context.workspaceId,
          workflowRunId: input.run_id,
          expectedAttempt: input.expected_attempt,
          mode: input.mode,
          actorUserId: context.userId,
        });
        return agentAccessSuccess({
          run_id: result.id,
          workflow_run_attempt: result.attempt,
          status: result.status,
        });
      } catch (error) {
        if (isInterModuleKnownError(workflowsInterModuleContract.methods.rerunWorkflowRun, error)) {
          return mapProducerError(error.code, error.details);
        }
        throw error;
      }
    },
  };
}

function createFireManualTriggerTool(triggers: TriggersInterModuleClient): AgentAccessTool {
  return {
    name: 'fire_manual_trigger',
    description:
      'Start a workflow from its manual trigger. Supply idempotency_key whenever this call may be retried. The gateway fingerprints the grant, key, definition, and canonical inputs: the same key and request returns the existing run with deduplicated true, while a different definition or inputs starts a new run. A retry without a key can start a second run.',
    inputSchema: fireManualTriggerInputJsonSchema,
    outputSchema: agentAccessOutputSchema(fireManualTriggerResultJsonSchema),
    validateInput: (input) => fireManualTriggerInputSchema.safeParse(input).success,
    validateResult: (result) => fireManualTriggerResultSchema.safeParse(result).success,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    execute: async ({context, arguments: rawInput}) => {
      const input = parseInput(fireManualTriggerInputSchema, rawInput);
      if (!input) return invalidRequest();

      try {
        const result = await triggers.fireManualTrigger({
          workspaceId: context.workspaceId,
          definitionId: input.definition_id,
          userId: context.userId,
          ...optionalField('inputs', input.inputs),
          idempotencyKey: deriveManualTriggerIdempotencyKey({
            grantId: context.credential.grantId,
            idempotencyKey: input.idempotency_key ?? randomUUID(),
            definitionId: input.definition_id,
            inputs: input.inputs,
          }),
        });
        return agentAccessSuccess({
          run_id: result.id,
          name: result.name,
          deduplicated: result.deduplicated,
        });
      } catch (error) {
        if (isInterModuleKnownError(triggersInterModuleContract.methods.fireManualTrigger, error)) {
          return mapProducerError(error.code, error.details);
        }
        throw error;
      }
    },
  };
}

function createDevRunTool(triggers: TriggersInterModuleClient): AgentAccessTool {
  return {
    name: 'create_dev_run',
    description:
      'Iterate on a workflow against a real past event: call list_trigger_events with replayable=true, read one payload with get_trigger_event, then call create_dev_run with content, replay_event_id, and dry_run: true until check_passed is true. A passing check means the definition resolved and validated, the trigger exists, the event matches, and the filter passed; it does not cover admission, run creation, or execution, so call create_dev_run again for a real run and it can still fail. Read the run with get_workflow_run and its logs, fix the YAML, and repeat. Only the YAML is uploaded; scripts and other working-tree changes are not. Use rerun_workflow_run to repeat an unchanged file. config_path is required. Dev runs have no idempotency key; after tool-failed or a transport timeout, list workflow runs for the project with origin dev before retrying.',
    inputSchema: createDevRunInputJsonSchema,
    outputSchema: agentAccessOutputSchema(createDevRunResultJsonSchema),
    validateInput: (input) => createDevRunInputSchema.safeParse(input).success,
    validateResult: (result) => createDevRunResultSchema.safeParse(result).success,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    execute: ({context, arguments: rawInput}) => {
      const input = parseInput(createDevRunInputSchema, rawInput);
      if (!input) return invalidRequest();
      return executeDevRun(input, context.workspaceId, context.userId, triggers);
    },
  };
}

interface ManualTriggerIdempotencyKeyParams {
  grantId: string;
  idempotencyKey: string;
  definitionId: string;
  inputs: Record<string, unknown> | undefined;
}

function deriveManualTriggerIdempotencyKey(params: ManualTriggerIdempotencyKeyParams): string {
  const request = JSON.stringify({
    definition_id: params.definitionId,
    inputs: params.inputs === undefined ? null : canonicalizeJson(params.inputs),
  });
  const requestHash = createHash('sha256').update(request, 'utf8').digest('hex');
  return `agent-access:${params.grantId}:${params.idempotencyKey}:${requestHash}`;
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (typeof value !== 'object' || value === null) return value;

  const sorted = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalizeJson((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

type CreateDevRunRequest = Parameters<TriggersInterModuleClient['createDevRun']>[0];

type CreateDevRunInput = ReturnType<typeof createDevRunInputSchema.parse>;

async function executeDevRun(
  input: CreateDevRunInput,
  workspaceId: string,
  userId: string,
  triggers: TriggersInterModuleClient,
) {
  const request: CreateDevRunRequest = {
    workspaceId,
    projectId: input.project_id,
    ...optionalField('ref', input.ref),
    ...optionalField('content', input.content),
    configPath: input.config_path,
    triggerKey: input.trigger,
    ...optionalField('commit', input.commit),
    ...optionalField('inputs', input.inputs),
    ...optionalField('replayEventId', input.replay_event_id),
    userId,
  };

  try {
    if (input.dry_run) return await executeDryRun(triggers, request);
    return await executeRealDevRun(triggers, request);
  } catch (error) {
    const method = input.dry_run
      ? triggersInterModuleContract.methods.checkDevRun
      : triggersInterModuleContract.methods.createDevRun;
    if (isInterModuleKnownError(method, error)) {
      return mapProducerError(error.code, error.details);
    }
    throw error;
  }
}

async function executeDryRun(triggers: TriggersInterModuleClient, request: CreateDevRunRequest) {
  const result = await triggers.checkDevRun(request);
  return agentAccessSuccess({
    dry_run: true,
    check_passed: result.checkPassed,
    ...(result.ref === undefined ? {} : {ref: result.ref}),
    commit: result.commit,
    ...(result.warnings === undefined ? {} : {warnings: mapDevRunWarnings(result.warnings)}),
  });
}

async function executeRealDevRun(
  triggers: TriggersInterModuleClient,
  request: CreateDevRunRequest,
) {
  const result = await triggers.createDevRun(request);
  return agentAccessSuccess({
    run_id: result.id,
    ...(result.ref === undefined ? {} : {ref: result.ref}),
    commit: result.commit,
    ...(result.warnings === undefined ? {} : {warnings: mapDevRunWarnings(result.warnings)}),
  });
}

function mapDevRunWarnings(
  warnings: readonly {code: string; message: string; path?: string | undefined}[],
) {
  return warnings.slice(0, createDevRunResultJsonSchema.properties.warnings.maxItems);
}

function mapProducerError(
  code: string,
  details: Record<string, unknown>,
): ReturnType<typeof agentAccessError> {
  if (code === 'invalid-definition' && Array.isArray(details.errors)) {
    return agentAccessError(code, {
      details: buildBoundedErrorListDetails(
        'errors',
        details.errors as Array<Record<string, unknown>>,
        mapDefinitionError,
      ),
    });
  }
  const devRunDetails = mapDevRunErrorDetails(code, details);
  if (devRunDetails !== undefined) return agentAccessError(code, {details: devRunDetails});
  if (code === 'admission-denied' && typeof details.reason === 'string') {
    const requiredAction = mapRequiredAction(details.requiredAction);
    return agentAccessError(code, {
      details: {
        reason: boundErrorDetail(details.reason),
        ...(requiredAction === undefined ? {} : {required_action: requiredAction}),
      },
    });
  }
  if (code === 'attempt-mismatch' && typeof details.currentAttempt === 'number') {
    return agentAccessError(code, {details: {current_attempt: details.currentAttempt}});
  }
  if (code === 'run-already-finished' && typeof details.status === 'string') {
    return agentAccessError(code, {details: {status: details.status}});
  }
  return agentAccessError(code);
}

function mapDevRunErrorDetails(
  code: string,
  details: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (code === 'trigger-not-found' && Array.isArray(details.availableTriggerKeys)) {
    return buildBoundedStringListDetails(
      'available_trigger_keys',
      details.availableTriggerKeys.filter((key): key is string => typeof key === 'string'),
    );
  }
  if (code === 'replay-event-mismatch') {
    const mismatchDetails = mapReplayEventMismatchDetails(details);
    if (Object.keys(mismatchDetails).length > 0) return mismatchDetails;
  }
  if (code === 'trigger-filtered' && typeof details.reason === 'string') {
    return {reason: boundErrorDetail(details.reason)};
  }
  return undefined;
}

function mapRequiredAction(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.reason !== 'string' ||
    typeof value.message !== 'string' ||
    typeof value.url !== 'string'
  ) {
    return undefined;
  }
  return {
    reason: boundErrorDetail(value.reason),
    message: boundErrorDetail(value.message),
    url: boundErrorDetail(value.url),
  };
}

function buildBoundedErrorListDetails<T>(
  itemKey: string,
  items: readonly T[],
  mapItem: (item: T) => unknown,
): Record<string, unknown> {
  const boundedItems: unknown[] = [];
  for (const item of items) {
    const candidateItem = mapItem(item);
    const candidate = {
      [itemKey]: [...boundedItems, candidateItem],
      total: items.length,
      truncated: false,
    };
    if (serializedErrorDetailsByteLength(candidate) > AGENT_ACCESS_ERROR_LIST_BUDGET_BYTES) break;
    boundedItems.push(candidateItem);
  }

  return {
    [itemKey]: boundedItems,
    total: items.length,
    truncated: boundedItems.length < items.length,
  };
}

function buildBoundedStringListDetails(
  itemKey: string,
  items: readonly string[],
): Record<string, unknown> {
  return buildBoundedErrorListDetails(itemKey, items, (item) => boundErrorDetail(item));
}

function mapReplayEventMismatchDetails(details: Record<string, unknown>): Record<string, string> {
  const fields = {
    event_source: details.eventSource,
    event_name: details.eventName,
    trigger_source: details.triggerSource,
    trigger_event: details.triggerEvent,
  };
  return Object.fromEntries(
    Object.entries(fields)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => [key, boundErrorDetail(value)]),
  );
}

function mapDefinitionError(value: Record<string, unknown>): Record<string, unknown> {
  return {
    message: boundErrorDetail(value.message as string),
    ...(typeof value.path === 'string' ? {path: boundErrorDetail(value.path)} : {}),
    ...(typeof value.reason === 'string' ? {reason: boundErrorDetail(value.reason)} : {}),
  };
}

function serializedErrorDetailsByteLength(value: Record<string, unknown>): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Agent-access error details are not serializable');
  return utf8Encoder.encode(serialized).byteLength;
}

function boundErrorDetail(value: string): string {
  return truncateAgentAccessUtf8(value, AGENT_ACCESS_ERROR_DETAIL_STRING_MAX_BYTES).value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
