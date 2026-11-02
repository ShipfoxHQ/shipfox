import type {Tool} from '@earendil-works/pi-ai';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {SHIPFOX_BUILTIN_CONNECTION_ID} from '@shipfox/api-integration-shipfox-dto';
import {type AgentLocalTool, createReadSkillTool} from '../local-tools/read-skill.js';

type CatalogTool = Awaited<
  ReturnType<IntegrationsModuleClient['listConversationTools']>
>['tools'][number];

export type ConversationTool =
  | {kind: 'local'; name: string; tool: AgentLocalTool}
  | {kind: 'integration'; name: string; connectionId: string; tool: CatalogTool};

export interface ConversationToolSet {
  tools: ConversationTool[];
  /** The definitions a model is told about, ordered by name so the pinned bytes are stable. */
  definitions: Tool[];
}

function toDefinition(name: string, description: string, schema: Record<string, unknown>): Tool {
  // pi-ai types parameters with a schema builder, but providers only read the JSON Schema.
  return {name, description, parameters: schema as unknown as Tool['parameters']};
}

/** The tools a conversation offers: Agent's own, and those Integrations serves to conversations. */
export async function listConversationToolSet(
  integrations: IntegrationsModuleClient,
): Promise<ConversationToolSet> {
  const {tools: catalog} = await integrations.listConversationTools({});
  const tools: ConversationTool[] = [];
  for (const tool of catalog) {
    // Only the built-in connection is addressable without a user choice. Other providers arrive
    // with integration tools.
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
  // Code-unit order, not localeCompare, so the pinned bytes never depend on the runtime locale.
  tools.sort((left, right) => Number(left.name > right.name) - Number(left.name < right.name));

  return {
    tools,
    definitions: tools.map((entry) =>
      toDefinition(entry.name, entry.tool.description, entry.tool.inputSchema),
    ),
  };
}
