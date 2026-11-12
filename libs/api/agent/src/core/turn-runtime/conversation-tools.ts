import {createHash} from 'node:crypto';
import type {Tool} from '@earendil-works/pi-ai';
import {sanitizeAgentIntegrationConnectionSlug} from '@shipfox/api-agent-dto';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import {SHIPFOX_BUILTIN_CONNECTION_ID} from '@shipfox/api-integration-shipfox-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {type AgentLocalTool, createReadSkillTool} from '../local-tools/read-skill.js';
import type {ResolvedProjectAgent} from '../project-agents.js';

type CatalogTool = Awaited<
  ReturnType<IntegrationsModuleClient['listConversationTools']>
>['tools'][number];

export type ConversationTool =
  | {kind: 'local'; name: string; tool: AgentLocalTool}
  | {
      kind: 'integration';
      name: string;
      connectionId: string;
      tool: CatalogTool;
      /** The agent's file granted the tool, so the provider's full catalog applies to the call. */
      grantedByAgent?: true;
    };

export interface ConversationToolSet {
  tools: ConversationTool[];
  /** The definitions a model is told about, ordered by name so the pinned bytes are stable. */
  definitions: Tool[];
}

/** Most model providers cap a tool name at this length. */
const MAX_TOOL_NAME_LENGTH = 64;
const DIGEST_LENGTH = 8;

function toDefinition(name: string, description: string, schema: Record<string, unknown>): Tool {
  // pi-ai types parameters with a schema builder, but providers only read the JSON Schema.
  return {name, description, parameters: schema as unknown as Tool['parameters']};
}

/**
 * The tools a conversation offers: Agent's own, those Integrations serves to every conversation,
 * and those the agent's file grants with `integrations:`. The file is read when the tool set is
 * built, so a tool removed from it stops being callable, even in a conversation that pinned it.
 */
export async function listConversationToolSet(params: {
  integrations: IntegrationsModuleClient;
  workspaceId: string;
  projectId: string;
  agent?: ResolvedProjectAgent | undefined;
}): Promise<ConversationToolSet> {
  const {integrations} = params;
  const {tools: catalog} = await integrations.listConversationTools({});
  const tools: ConversationTool[] = [];
  for (const tool of catalog) {
    // Only the built-in connection is addressable without a user choice. Other providers arrive
    // through the agent's file.
    if (tool.provider !== 'shipfox') continue;
    tools.push({
      kind: 'integration',
      name: tool.id,
      connectionId: SHIPFOX_BUILTIN_CONNECTION_ID,
      tool,
    });
  }
  const readSkill = createReadSkillTool();
  tools.push({kind: 'local', name: readSkill.name, tool: readSkill});
  const names = new Set(tools.map((entry) => entry.name));
  for (const entry of await listConfiguredIntegrationTools(params)) {
    if (names.has(entry.name)) continue;
    names.add(entry.name);
    tools.push(entry);
  }
  // Code-unit order, not localeCompare, so the pinned bytes never depend on the runtime locale.
  tools.sort((left, right) => Number(left.name > right.name) - Number(left.name < right.name));

  return {
    tools,
    definitions: tools.map((entry) =>
      toDefinition(entry.name, entry.tool.description, entry.tool.inputSchema),
    ),
  };
}

/**
 * What the agent's file grants. A grant that no longer resolves, such as one whose connection was
 * removed since the file synced, is logged and leaves the conversation with its other tools.
 */
async function listConfiguredIntegrationTools(params: {
  integrations: IntegrationsModuleClient;
  workspaceId: string;
  projectId: string;
  agent?: ResolvedProjectAgent | undefined;
}): Promise<ConversationTool[]> {
  const selections =
    params.agent?.kind === 'configured' ? params.agent.agent.document.integrations : undefined;
  if (selections === undefined) return [];

  try {
    const {integrations: grants} = await params.integrations.resolveAgentTools({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      integrations: selections.map((selection) => ({
        ...(selection.connection === undefined ? {} : {connection: selection.connection}),
        include: selection.include,
        ...(selection.exclude === undefined ? {} : {exclude: selection.exclude}),
      })),
    });
    return grants
      .filter((grant) => grant.provider !== 'shipfox')
      .flatMap((grant) =>
        grant.tools
          // A conversation reads text, so a tool that returns bytes or an image has no use here.
          .filter((tool) => tool.result === 'json')
          .map((tool): ConversationTool => {
            const {description, result: _result, ...frozen} = tool;
            return {
              kind: 'integration',
              name: integrationToolName(grant.connectionSlug, tool.id),
              connectionId: grant.connectionId,
              grantedByAgent: true,
              tool: {
                ...frozen,
                provider: grant.provider,
                description: describeTool(description, tool.methods),
              },
            };
          }),
      );
  } catch (error) {
    const method = integrationsInterModuleContract.methods.resolveAgentTools;
    if (!isInterModuleKnownError(method, error)) throw error;
    logger().warn(
      {err: error, projectId: params.projectId, details: error.details},
      'An agent file grants integration tools that no longer resolve',
    );
    return [];
  }
}

/**
 * Names a model can call. The connection keeps two connections of one provider apart. A name over
 * the cap ends in a digest of the full name, so two long names never collapse into one.
 */
function integrationToolName(connectionSlug: string, toolId: string): string {
  const full = `${sanitizeAgentIntegrationConnectionSlug(connectionSlug)}__${toolId}`;
  if (full.length <= MAX_TOOL_NAME_LENGTH) return full;
  const digest = createHash('sha256').update(full).digest('hex').slice(0, DIGEST_LENGTH);
  return `${full.slice(0, MAX_TOOL_NAME_LENGTH - DIGEST_LENGTH - 1)}_${digest}`;
}

function describeTool(description: string, methods: readonly {id: string}[] | undefined): string {
  if (methods === undefined) return description;
  return `${description} Set \`method\` to one of: ${methods.map(({id}) => id).join(', ')}.`;
}
