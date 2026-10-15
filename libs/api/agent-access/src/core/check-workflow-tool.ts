import {
  AGENT_ACCESS_CHECK_WORKFLOW_MAX_EVENT_IDS,
  AGENT_ACCESS_ERROR_DETAIL_STRING_MAX_BYTES,
  AGENT_ACCESS_RESPONSE_MAX_BYTES,
  agentAccessOutputSchema,
  checkWorkflowInputJsonSchema,
  checkWorkflowInputSchema,
  checkWorkflowResultJsonSchema,
  checkWorkflowResultSchema,
} from '@shipfox/api-agent-access-dto';
import {
  type TriggersInterModuleClient,
  triggersInterModuleContract,
} from '@shipfox/api-triggers-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {mapProducerError} from './action-tools.js';
import {agentAccessSuccess} from './envelope.js';
import {fitAgentAccessResponseToCeiling, truncateAgentAccessUtf8} from './response.js';
import {invalidRequest, optionalField, parseInput} from './tool-utils.js';
import type {AgentAccessTool} from './tools.js';

type CheckWorkflowOutput = Awaited<ReturnType<TriggersInterModuleClient['checkWorkflow']>>;
type CheckedEvent = NonNullable<CheckWorkflowOutput['events']>[number];

// Errors and warnings share most of the response; events and triggers are small and bounded.
const ERRORS_BUDGET_BYTES = 64 * 1024;
const WARNINGS_BUDGET_BYTES = 24 * 1024;
const utf8Encoder = new TextEncoder();

export function createCheckWorkflowTool(triggers: TriggersInterModuleClient): AgentAccessTool {
  return {
    name: 'check_workflow',
    description: `Validate a workflow file and check how one of its triggers would have handled past events, without writing anything or starting a run. Supply project_id, config_path, and content, ref, or both; commit requires ref. content is the complete YAML of a file that is not pushed yet; prompt files and actions that are not uploaded are read from ref, or from the default branch when ref is omitted. An invalid definition is a result with valid: false, not an error. errors lists the errors of the first validation stage that fails, so fixing them can reveal more. warnings are returned only for valid definitions. To check events, set trigger to an integration trigger key and pass up to ${AGENT_ACCESS_CHECK_WORKFLOW_MAX_EVENT_IDS} event_ids from list_trigger_events, filtered by the trigger's source and event with replayable: true. Each event gets one result: matched, filtered, filter-error, event-mismatch, payload-unavailable, or not-found, decided as dispatch decides. event_counts summarizes them. A valid result does not mean the workflow runs: steps, toolchains, and permissions are only checked by a run.`,
    inputSchema: checkWorkflowInputJsonSchema,
    outputSchema: agentAccessOutputSchema(checkWorkflowResultJsonSchema),
    validateInput: (input) => checkWorkflowInputSchema.safeParse(input).success,
    validateResult: (result) => checkWorkflowResultSchema.safeParse(result).success,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    execute: async ({context, arguments: rawInput}) => {
      const input = parseInput(checkWorkflowInputSchema, rawInput);
      if (!input) return invalidRequest();

      let result: CheckWorkflowOutput;
      try {
        result = await triggers.checkWorkflow({
          workspaceId: context.workspaceId,
          projectId: input.project_id,
          configPath: input.config_path,
          ...optionalField('ref', input.ref),
          ...optionalField('content', input.content),
          ...optionalField('actions', input.actions),
          ...optionalField('commit', input.commit),
          ...optionalField('triggerKey', input.trigger),
          ...optionalField('eventIds', input.event_ids),
        });
      } catch (error) {
        if (isInterModuleKnownError(triggersInterModuleContract.methods.checkWorkflow, error)) {
          return mapProducerError(error.code, error.details);
        }
        throw error;
      }
      return fitAgentAccessResponseToCeiling(
        agentAccessSuccess(projectResult(result)),
        AGENT_ACCESS_RESPONSE_MAX_BYTES,
      );
    },
  };
}

function projectResult(result: CheckWorkflowOutput): Record<string, unknown> {
  // Errors stay whole, so an agent can act on them; the budget drops entries instead.
  const errors = withinBudget(result.errors, ERRORS_BUDGET_BYTES);
  const warnings = withinBudget(result.warnings, WARNINGS_BUDGET_BYTES);

  return {
    valid: result.valid,
    ref: result.ref,
    commit: result.commit,
    errors,
    errors_total: result.errorCount,
    errors_truncated: errors.length < result.errorCount,
    warnings,
    warnings_truncated: warnings.length < result.warnings.length,
    triggers: Object.entries(result.triggers).map(([key, trigger]) => ({
      key,
      source: trigger.source,
      ...(trigger.event === undefined ? {} : {event: trigger.event}),
      ...(trigger.filter === undefined ? {} : {filter: trigger.filter}),
    })),
    ...(result.events === undefined ? {} : {events: result.events.map(projectEvent)}),
    ...(result.eventCounts === undefined
      ? {}
      : {
          event_counts: {
            matched: result.eventCounts.matched ?? 0,
            filtered: result.eventCounts.filtered ?? 0,
            filter_error: result.eventCounts['filter-error'] ?? 0,
            event_mismatch: result.eventCounts['event-mismatch'] ?? 0,
            payload_unavailable: result.eventCounts['payload-unavailable'] ?? 0,
            not_found: result.eventCounts['not-found'] ?? 0,
          },
        }),
  };
}

function projectEvent(event: CheckedEvent): Record<string, unknown> {
  return {
    event_id: event.eventId,
    result: event.result,
    ...(event.source === undefined ? {} : {source: bound(event.source)}),
    ...(event.event === undefined ? {} : {event: bound(event.event)}),
    ...(event.receivedAt === undefined ? {} : {received_at: event.receivedAt}),
    ...(event.reason === undefined ? {} : {reason: bound(event.reason)}),
    ...(event.diagnostic === undefined ? {} : {diagnostic: projectDiagnostic(event.diagnostic)}),
  };
}

/**
 * Keeps only the fields a filter failure can explain itself with. Fields that
 * describe the payload, such as a list size, are left out.
 */
function projectDiagnostic(
  diagnostic: NonNullable<CheckedEvent['diagnostic']>,
): Record<string, unknown> {
  const fields = diagnostic as Record<string, unknown>;
  return {
    code: diagnostic.code,
    ...(typeof fields.path === 'string' ? {path: bound(fields.path)} : {}),
    ...(typeof fields.index === 'number' ? {index: fields.index} : {}),
    ...(typeof fields.offset === 'number' ? {offset: fields.offset} : {}),
    ...(typeof fields.classification === 'string' ? {classification: fields.classification} : {}),
    ...(typeof fields.actualType === 'string' ? {actual_type: fields.actualType} : {}),
  };
}

function withinBudget<T>(items: readonly T[], budgetBytes: number): T[] {
  const kept: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const itemBytes = utf8Encoder.encode(JSON.stringify(item)).byteLength + 1;
    if (bytes + itemBytes > budgetBytes) break;
    kept.push(item);
    bytes += itemBytes;
  }
  return kept;
}

function bound(value: string): string {
  return truncateAgentAccessUtf8(value, AGENT_ACCESS_ERROR_DETAIL_STRING_MAX_BYTES).value;
}
