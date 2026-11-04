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
 * One `on:` rule of an agent file. It claims the requests of a source, narrowed
 * by a filter. A rule has no `event`, `with`, `secrets`, or `config`, because
 * only requests can match.
 */
export const agentRuleSchema = z.strictObject({
  source: z.string().min(1).meta({
    description:
      'Selects the slug of the integration connection whose requests this rule covers, such as `slack_acme` or `linear_acme`. Use the slug of your own connection. The integration must let people talk to agents.',
  }),
  filter: z.string().min(1).optional().meta({
    description:
      'Narrows the rule to requests that match this condition. The condition can use `request`, where the request was made, and `event`, the raw payload. Without it, the rule covers every request from the source. See [Expressions](/reference/expressions).',
  }),
});

export type AgentRule = z.infer<typeof agentRuleSchema>;

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
  on: z.array(agentRuleSchema).optional().meta({
    description:
      'Declares the requests from Slack or Linear that the agent claims. Sync checks and stores these rules. Requests are not routed by them yet.',
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
  const prefix = directory.endsWith('/') ? directory : `${directory}/`;
  if (!path.startsWith(prefix)) return undefined;
  const fileName = path.slice(prefix.length);
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
