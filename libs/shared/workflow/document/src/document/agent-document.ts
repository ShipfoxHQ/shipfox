import {z} from 'zod';
import {agentThinkingSchema} from './step-enums.js';
import {
  WORKFLOW_LITERAL_NAME_PATTERN,
  workflowDocumentPromptSchema,
  workflowDocumentStepIntegrationSchema,
} from './workflow-document.js';

/** The directory, relative to the repository root, that holds agent files. */
export const AGENT_DOCUMENT_DIRECTORY = '.shipfox/agents/';
/** The key of the built-in agent. Its file adds to the built-in agent instead of replacing it. */
export const AGENT_DOCUMENT_DEFAULT_KEY = 'shippy';
export const AGENT_DOCUMENT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * One file in `.shipfox/agents/`. The file name without its extension is the
 * agent's key, so the document declares no key. `shippy.yaml` adds to the
 * built-in agent and every field is optional. Any other file is a custom agent,
 * which `parseAgentDocument` requires to set `description` and `instructions`.
 */
export const agentDocumentSchema = z.strictObject({
  name: z.string().min(1).regex(WORKFLOW_LITERAL_NAME_PATTERN).optional().meta({
    description:
      'Sets the display name of the agent. Without it, the agent shows its key, the file name without the extension. The name never identifies the agent.',
  }),
  description: z.string().min(1).optional().meta({
    description:
      'Describes what the agent is for. Users read it when they pick an agent. Required for a custom agent.',
  }),
  instructions: workflowDocumentPromptSchema.optional().meta({
    description:
      'Gives the agent its instructions. Use a string, or a list of parts that Shipfox joins with a blank line. A part is a string or a `file` reference. In `shippy.yaml` the instructions add to the built-in prompt. Required for a custom agent, where they are the whole prompt.',
  }),
  model: z.string().min(1).optional().meta({
    description:
      'Selects the model that the agent uses. Without it, the workspace default applies.',
  }),
  provider: z.string().min(1).optional().meta({
    description:
      'Selects the model provider for the agent. See [Model providers](/reference/model-providers).',
  }),
  thinking: agentThinkingSchema.optional().meta({
    description:
      'Sets agent reasoning. `default` requests the provider default without workspace or deployment overrides. Omitting this field uses configured defaults or `xhigh`.',
  }),
  integrations: z.array(workflowDocumentStepIntegrationSchema).min(1).optional().meta({
    description:
      'Adds tools from integration connections to the agent. See [integrations and tools](/understand/integrations-connections-and-tools).',
  }),
});

export type AgentDocument = z.infer<typeof agentDocumentSchema>;

export const invalidAgentDocumentErrorCode = 'invalid-agent-document';

export class InvalidAgentDocumentError extends Error {
  readonly code = invalidAgentDocumentErrorCode;
  readonly validationError: z.ZodError<AgentDocument>;

  constructor(validationError: z.ZodError<AgentDocument>, cause: unknown = validationError) {
    super('Invalid agent document', {cause});
    this.name = 'InvalidAgentDocumentError';
    this.validationError = validationError;
  }
}

export interface ParseAgentDocumentOptions {
  /** The agent key, which decides whether `description` and `instructions` are required. */
  key: string;
}

export function parseAgentDocument(
  input: unknown,
  {key}: ParseAgentDocumentOptions,
): AgentDocument {
  const result = agentDocumentSchema.safeParse(input);
  if (!result.success) throw new InvalidAgentDocumentError(result.error);
  if (key === AGENT_DOCUMENT_DEFAULT_KEY) return result.data;

  const issues: z.core.$ZodIssue[] = [];
  for (const field of ['description', 'instructions'] as const) {
    if (result.data[field] !== undefined) continue;
    issues.push({
      code: 'custom',
      path: [field],
      input,
      message: `A custom agent requires "${field}".`,
    });
  }
  if (issues.length > 0) {
    throw new InvalidAgentDocumentError(new z.ZodError(issues) as z.ZodError<AgentDocument>);
  }
  return result.data;
}

/**
 * The agent key of a file path under the agent directory, or `undefined` when
 * the file is not a YAML file directly inside it. The key is the file name
 * without its extension.
 */
export function agentDocumentKeyForPath(
  path: string,
  directory: string = AGENT_DOCUMENT_DIRECTORY,
): string | undefined {
  if (!path.startsWith(directory)) return undefined;
  const fileName = path.slice(directory.length);
  if (fileName.includes('/')) return undefined;
  const extension = ['.yaml', '.yml'].find((candidate) => fileName.endsWith(candidate));
  if (extension === undefined) return undefined;
  const key = fileName.slice(0, -extension.length);
  return AGENT_DOCUMENT_KEY_PATTERN.test(key) ? key : undefined;
}

export function buildAgentDocumentJsonSchema({
  id = 'https://www.shipfox.io/docs/agent.schema.json',
}: {
  id?: string;
} = {}): Record<string, unknown> {
  const schema = z.toJSONSchema(agentDocumentSchema, {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  schema.$schema = 'https://json-schema.org/draft/2020-12/schema';
  schema.$id = id;
  schema.title = 'Shipfox Agent';
  return schema;
}
