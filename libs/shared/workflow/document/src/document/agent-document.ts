import {z} from 'zod';
import {agentThinkingSchema} from './step-enums.js';
import {
  workflowDocumentAgentModelSchema,
  workflowDocumentAgentProviderSchema,
  workflowDocumentPromptSchema,
  workflowDocumentStepIntegrationSchema,
} from './workflow-document.js';

/** The key of the built-in agent. `shippy.yaml` adds to it, and no custom agent can use the key. */
export const SHIPPY_AGENT_KEY = 'shippy';
export const AGENT_KEY_MAX_LENGTH = 64;
export const AGENT_KEY_PATTERN_SOURCE = `^[a-z0-9][a-z0-9_-]{0,${AGENT_KEY_MAX_LENGTH - 1}}$`;
export const AGENT_KEY_PATTERN = new RegExp(AGENT_KEY_PATTERN_SOURCE);
const AGENT_FILE_EXTENSION_PATTERN = /\.ya?ml$/;

export const agentDocumentSchema = z.strictObject({
  name: z.string().min(1).optional().meta({
    description:
      'Labels the agent in the picker. The file name identifies the agent, not this field. The picker shows the file name when this is empty.',
  }),
  description: z.string().min(1).optional().meta({
    description:
      'Tells people what the agent is for. A custom agent requires it. `shippy.yaml` does not.',
  }),
  instructions: workflowDocumentPromptSchema('workflow').optional().meta({
    description:
      'Gives the agent its instructions. Use a string, or a list of parts that Shipfox joins with a blank line. A part is a string or a `file` reference. A custom agent requires it. In `shippy.yaml`, the text is added to the built-in instructions.',
  }),
  provider: workflowDocumentAgentProviderSchema.optional(),
  model: workflowDocumentAgentModelSchema.optional(),
  thinking: agentThinkingSchema.optional(),
  integrations: z.array(workflowDocumentStepIntegrationSchema).min(1).optional().meta({
    description:
      'Adds tools from integration connections to this agent. See [integrations and tools](/understand/integrations-connections-and-tools).',
  }),
});

export type AgentDocument = z.infer<typeof agentDocumentSchema>;

export const agentDocumentFields = [
  'name',
  'description',
  'instructions',
  'provider',
  'model',
  'thinking',
  'integrations',
] as const satisfies readonly (keyof AgentDocument)[];

export const invalidAgentDocumentErrorCode = 'invalid-agent-document';

export class InvalidAgentDocumentError extends Error {
  readonly code = invalidAgentDocumentErrorCode;
  readonly validationError: z.ZodError;

  constructor(validationError: z.ZodError) {
    super('Invalid agent document', {cause: validationError});
    this.name = 'InvalidAgentDocumentError';
    this.validationError = validationError;
  }
}

/** The key an agent file declares by its name: the file name without `.yml` or `.yaml`. */
export function agentKeyFromFileName(fileName: string): string {
  return fileName.replace(AGENT_FILE_EXTENSION_PATTERN, '');
}

export function agentKeyIssue(key: string): string | undefined {
  if (AGENT_KEY_PATTERN.test(key)) return undefined;
  return `Agent file names must be lowercase letters, digits, "-" or "_", start with a letter or digit, and stay within ${AGENT_KEY_MAX_LENGTH} characters. "${key}" does not.`;
}

/**
 * Validates the content of one agent file. `key` is the file name without the
 * extension. `shippy` adds to the built-in agent, so all its fields are
 * optional. Every other agent is complete and requires `description` and
 * `instructions`.
 */
export function parseAgentDocument(input: unknown, {key}: {key: string}): AgentDocument {
  const keyIssue = agentKeyIssue(key);
  if (keyIssue !== undefined) {
    throw new InvalidAgentDocumentError(
      new z.ZodError([{code: 'custom', input, path: [], message: keyIssue}]),
    );
  }

  const result = agentDocumentSchema.safeParse(input);
  if (!result.success) throw new InvalidAgentDocumentError(result.error);

  const issues: z.core.$ZodIssue[] = [];
  if (key !== SHIPPY_AGENT_KEY) {
    for (const field of ['description', 'instructions'] as const) {
      if (result.data[field] === undefined) {
        issues.push({
          code: 'custom',
          input,
          path: [field],
          message: `A custom agent requires "${field}".`,
        });
      }
    }
  }
  if (issues.length > 0) throw new InvalidAgentDocumentError(new z.ZodError(issues));
  return result.data;
}

export function buildAgentJsonSchema({
  id = 'https://www.shipfox.io/docs/agent.schema.json',
}: {
  id?: string;
} = {}): Record<string, unknown> {
  const schema = z.toJSONSchema(agentDocumentSchema, {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  return {...schema, $id: id};
}
