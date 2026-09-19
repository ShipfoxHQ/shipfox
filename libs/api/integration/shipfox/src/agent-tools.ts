import {randomUUID} from 'node:crypto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import type {
  AgentToolCallInput,
  AgentToolCatalogEntry,
  AgentToolJsonSchema,
  AgentToolSelectionCatalog,
  AgentToolSession,
  AgentToolsProvider,
  IntegrationConnection,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import type {TriggersInterModuleClient} from '@shipfox/api-triggers-dto/inter-module';
import {triggersInterModuleContract} from '@shipfox/api-triggers-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';

export const SHIPFOX_PROVIDER = 'shipfox' as const;
export const SHIPFOX_BUILTIN_CONNECTION_ID = '00000000-0000-4000-8000-000000000001';
export const SHIPFOX_INPUTS_MAX_BYTES = 16 * 1024;
export const SHIPFOX_IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export type ShipfoxAgentToolRequiredScope = readonly unknown[];
export type ShipfoxIntegrationConnection = IntegrationConnection<'shipfox'>;

export type ShipfoxToolCallResult = {
  isError?: boolean | undefined;
  content: readonly {type: 'text'; text: string}[];
  structuredContent?: Record<string, unknown> | undefined;
};

export interface ShipfoxAgentToolsProviderOptions {
  definitions: Pick<DefinitionsInterModuleClient, 'getDefinitionByConfigPath'>;
  triggers: Pick<TriggersInterModuleClient, 'fireManualTrigger'>;
  workflows: Pick<WorkflowsModuleClient, 'getWorkflowRunOverview'>;
}

const startWorkflowRunInputSchema = objectSchema(
  {
    workflow: {
      type: 'string',
      minLength: 1,
      maxLength: 1024,
      description: 'Synced workflow configuration path, such as .shipfox/workflows/deploy.yml',
    },
    project_id: {
      type: 'string',
      format: 'uuid',
      description: 'Project that owns the workflow. Defaults to the calling run project.',
    },
    inputs: {
      type: 'object',
      description: `Trigger inputs as a JSON object, limited to ${SHIPFOX_INPUTS_MAX_BYTES} UTF-8 bytes when serialized.`,
    },
    idempotency_key: {
      type: 'string',
      minLength: 1,
      maxLength: SHIPFOX_IDEMPOTENCY_KEY_MAX_LENGTH,
      description: 'Idempotency key for agent calls.',
    },
  },
  ['workflow'],
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const startWorkflowRunOutputSchema = objectSchema(
  {
    run_id: {type: 'string', format: 'uuid'},
    run_number: {type: 'integer', minimum: 1},
    name: {type: 'string'},
    project_id: {type: 'string', format: 'uuid'},
    deduplicated: {type: 'boolean'},
  },
  ['run_id', 'run_number', 'name', 'project_id', 'deduplicated'],
);

export const shipfoxAgentToolCatalog = [
  {
    id: 'start_workflow_run',
    description:
      'Start another synced workflow that has a manual trigger and return its run identity. The call does not wait for the child run to finish.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: [],
    inputSchema: startWorkflowRunInputSchema,
    outputSchema: startWorkflowRunOutputSchema,
  },
] as const satisfies readonly AgentToolCatalogEntry<ShipfoxAgentToolRequiredScope>[];

export const shipfoxAgentToolSelectionCatalog: AgentToolSelectionCatalog = {
  selectors: shipfoxAgentToolCatalog.map((tool) => ({
    token: tool.id,
    kind: 'standalone',
    sensitivity: tool.sensitivity,
    sensitive: tool.sensitive,
  })),
};

type ShipfoxToolCall = AgentToolCallInput;

export class ShipfoxAgentToolsProvider
  implements
    AgentToolsProvider<
      ShipfoxIntegrationConnection,
      ShipfoxAgentToolRequiredScope,
      unknown,
      ShipfoxToolCallResult
    >
{
  constructor(private readonly options: ShipfoxAgentToolsProviderOptions) {}

  catalog() {
    return shipfoxAgentToolCatalog;
  }

  selectionCatalog() {
    return shipfoxAgentToolSelectionCatalog;
  }

  openSession(
    input: OpenAgentToolsSessionInput<
      ShipfoxIntegrationConnection,
      ShipfoxAgentToolRequiredScope,
      unknown
    >,
  ): Promise<AgentToolSession<ShipfoxToolCallResult>> {
    return Promise.resolve({
      call: (call) => this.call(input, call),
      close: () => Promise.resolve(),
    });
  }

  private async call(
    input: OpenAgentToolsSessionInput<
      ShipfoxIntegrationConnection,
      ShipfoxAgentToolRequiredScope,
      unknown
    >,
    call: ShipfoxToolCall,
  ): Promise<ShipfoxToolCallResult> {
    const tool = input.tools.find((candidate) => candidate.id === call.toolId);
    if (tool === undefined) return toolError(`Unknown Shipfox tool: ${call.toolId}`);
    if (tool.id !== 'start_workflow_run') return toolError(`Unknown Shipfox tool: ${tool.id}`);

    const validationError = validateStartWorkflowRunArguments(call.arguments);
    if (validationError !== undefined) return toolError(validationError);

    const caller = input.caller;
    if (caller === undefined) {
      return toolError('Shipfox tools require workflow caller context', 'invalid-request');
    }

    const arguments_ = call.arguments;
    const projectId = stringArgument(arguments_, 'project_id') ?? caller.projectId;
    const workflow = stringArgument(arguments_, 'workflow');
    if (workflow === undefined) throw new Error('Validated workflow argument is missing');
    const idempotencyKey = idempotencyKeyForCall(arguments_, caller);

    try {
      const definition = await this.options.definitions.getDefinitionByConfigPath({
        workspaceId: caller.workspaceId,
        projectId,
        configPath: workflow,
      });
      const started = await this.options.triggers.fireManualTrigger({
        workspaceId: caller.workspaceId,
        definitionId: definition.definitionId,
        parentRun: {runId: caller.runId},
        ...(recordInput(arguments_.inputs) === undefined
          ? {}
          : {inputs: recordInput(arguments_.inputs)}),
        idempotencyKey,
      });
      const overview = await this.options.workflows.getWorkflowRunOverview({
        workspaceId: caller.workspaceId,
        workflowRunId: started.id,
      });
      if (overview === null) throw new Error(`Started workflow run was not found: ${started.id}`);

      return toolResult({
        run_id: started.id,
        run_number: overview.run.number,
        name: started.name,
        project_id: projectId,
        deduplicated: started.deduplicated,
      });
    } catch (error) {
      const mapped = mapStartWorkflowRunError(error);
      if (mapped !== undefined) return mapped;
      throw error;
    }
  }
}

export function createShipfoxAgentToolsProvider(
  options: ShipfoxAgentToolsProviderOptions,
): ShipfoxAgentToolsProvider {
  return new ShipfoxAgentToolsProvider(options);
}

function validateStartWorkflowRunArguments(args: Record<string, unknown>): string | undefined {
  const basicError = validateBasicArguments(args);
  if (basicError !== undefined) return basicError;

  if (args.project_id !== undefined && !isUuid(args.project_id)) {
    return 'Parameter project_id must be a UUID';
  }
  return validateOptionalArguments(args);
}

function validateBasicArguments(args: Record<string, unknown>): string | undefined {
  if (typeof args.workflow !== 'string' || args.workflow.length === 0) {
    return 'Missing required parameter: workflow';
  }
  if (args.workflow.length > 1024) return 'Parameter workflow must be at most 1024 characters';
  if (!isSafeConfigPath(args.workflow)) return 'Parameter workflow contains a control character';

  const properties = startWorkflowRunInputSchema.properties as Record<string, unknown>;
  const unknownParameter = Object.keys(args).find((name) => !(name in properties));
  return unknownParameter === undefined ? undefined : `Unknown parameter: ${unknownParameter}`;
}

function validateOptionalArguments(args: Record<string, unknown>): string | undefined {
  if (args.inputs !== undefined) {
    const inputError = validateInputs(args.inputs);
    if (inputError !== undefined) return inputError;
  }
  if (args.idempotency_key === undefined) return undefined;
  if (typeof args.idempotency_key !== 'string' || args.idempotency_key.length === 0) {
    return 'Parameter idempotency_key must be a non-empty string';
  }
  return [...args.idempotency_key].length > SHIPFOX_IDEMPOTENCY_KEY_MAX_LENGTH
    ? `Parameter idempotency_key must be at most ${SHIPFOX_IDEMPOTENCY_KEY_MAX_LENGTH} characters`
    : undefined;
}

function validateInputs(value: unknown): string | undefined {
  if (!isRecord(value)) return 'Parameter inputs must be an object';
  if (Object.hasOwn(value, '__proto__'))
    return 'Parameter inputs must not contain a __proto__ property';
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return 'Parameter inputs must be JSON serializable';
  }
  if (serialized === undefined) return 'Parameter inputs must be JSON serializable';
  if (new TextEncoder().encode(serialized).byteLength > SHIPFOX_INPUTS_MAX_BYTES) {
    return `Parameter inputs must contain at most ${SHIPFOX_INPUTS_MAX_BYTES} UTF-8 bytes when serialized`;
  }
  return undefined;
}

function mapStartWorkflowRunError(error: unknown): ShipfoxToolCallResult | undefined {
  if (
    isInterModuleKnownError(definitionsInterModuleContract.methods.getDefinitionByConfigPath, error)
  ) {
    return mappedToolError(error.code, error.message, error.details);
  }
  if (isInterModuleKnownError(triggersInterModuleContract.methods.fireManualTrigger, error)) {
    const code = error.code;
    if (
      code === 'manual-trigger-not-found' ||
      code === 'definition-not-found' ||
      code === 'parent-run-not-found' ||
      code === 'run-depth-exceeded' ||
      code === 'run-tree-limit-exceeded' ||
      code === 'admission-denied'
    ) {
      return mappedToolError(code, error.message, error.details);
    }
  }
  return undefined;
}

function idempotencyKeyForCall(
  args: Record<string, unknown>,
  caller: NonNullable<OpenAgentToolsSessionInput['caller']>,
): string {
  const isAgentCall =
    caller.callerKind === 'agent' ||
    (caller.callerKind === undefined && args.idempotency_key !== undefined);
  if (isAgentCall) {
    const suppliedKey = stringArgument(args, 'idempotency_key');
    return suppliedKey === undefined ? randomUUID() : `${caller.runId}:${suppliedKey}`;
  }

  // The deterministic tool-step path does not include callIndex, so retries of
  // one step attempt reuse the key while a rerun receives a new step attempt.
  return `${caller.stepId}:${caller.stepAttempt}`;
}

function mappedToolError(code: string, message: string, details: unknown): ShipfoxToolCallResult {
  return {
    isError: true,
    content: [{type: 'text', text: message}],
    structuredContent: {code, ...(isRecord(details) ? details : {})},
  };
}

function toolError(message: string, code = 'invalid-request'): ShipfoxToolCallResult {
  return {isError: true, content: [{type: 'text', text: message}], structuredContent: {code}};
}

function toolResult(result: Record<string, unknown>): ShipfoxToolCallResult {
  return {content: [{type: 'text', text: JSON.stringify(result)}], structuredContent: result};
}

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[],
): AgentToolJsonSchema {
  return {type: 'object', additionalProperties: false, properties, required};
}

function recordInput(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringArgument(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === 'string' ? args[key] : undefined;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isSafeConfigPath(value: string): boolean {
  return [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return !(code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
