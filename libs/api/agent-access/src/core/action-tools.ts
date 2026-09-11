import {createHash, randomUUID} from 'node:crypto';
import {
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
import {invalidRequest, optionalField, parseInput} from './tool-utils.js';
import type {AgentAccessTool} from './tools.js';

export interface AgentAccessActionToolsOptions {
  workflows: WorkflowsModuleClient;
  triggers: TriggersInterModuleClient;
}

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
      'Create a development workflow run from a project ref. config_path is required. Dev runs have no idempotency key; after tool-failed or a transport timeout, list workflow runs for the project with origin dev before retrying.',
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
    execute: async ({context, arguments: rawInput}) => {
      const input = parseInput(createDevRunInputSchema, rawInput);
      if (!input) return invalidRequest();

      try {
        const result = await triggers.createDevRun({
          workspaceId: context.workspaceId,
          projectId: input.project_id,
          ref: input.ref,
          configPath: input.config_path,
          triggerKey: input.trigger,
          ...optionalField('commit', input.commit),
          ...optionalField('inputs', input.inputs),
          ...optionalField('replayEventId', input.replay_event_id),
          userId: context.userId,
        });
        return agentAccessSuccess({run_id: result.id, commit: result.commit});
      } catch (error) {
        if (isInterModuleKnownError(triggersInterModuleContract.methods.createDevRun, error)) {
          return mapProducerError(error.code, error.details);
        }
        throw error;
      }
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

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalizeJson((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

function mapProducerError(
  code: string,
  details: Record<string, unknown>,
): ReturnType<typeof agentAccessError> {
  if (code === 'admission-denied' && isRecord(details.requiredAction)) {
    return agentAccessError(code, {
      details: {
        required_action: {
          reason: details.requiredAction.reason,
          message: details.requiredAction.message,
          url: details.requiredAction.url,
        },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
