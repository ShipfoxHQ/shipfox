import type {IntegrationActionTool} from '@shipfox/client-logs';

/** Keep only frozen identity and read classification needed by log presentation. */
export function toIntegrationActionTools(
  config: Record<string, unknown> | null | undefined,
): IntegrationActionTool[] {
  if (isRecord(config?.tool)) return toolStepActionTools(config.tool);
  return integrationConfigs(config).flatMap(toIntegrationTools);
}

function integrationConfigs(config: Record<string, unknown> | null | undefined): unknown[] {
  if (Array.isArray(config?.integrations)) return config.integrations;
  const servers = Array.isArray(config?.mcpServers) ? config.mcpServers : [];
  const server = servers.find(
    (value) => isRecord(value) && value.name === 'shipfox_integration_tools',
  );
  return isRecord(server) && Array.isArray(server.integrations) ? server.integrations : [];
}

function toIntegrationTools(value: unknown): IntegrationActionTool[] {
  if (!isRecord(value) || !Array.isArray(value.tools)) return [];
  const {provider, connectionId, connectionSlug} = value;
  if (!isString(provider) || !isString(connectionId) || !isString(connectionSlug)) return [];
  return value.tools.flatMap((tool): IntegrationActionTool[] => {
    if (!isRecord(tool) || !isString(tool.id) || !isSensitivity(tool.sensitivity)) return [];
    const methods = Array.isArray(tool.methods) ? tool.methods.flatMap(toMethod) : undefined;
    return [
      {
        provider,
        connectionId,
        connectionSlug,
        toolId: tool.id,
        sensitivity: tool.sensitivity,
        ...(methods === undefined ? {} : {methods}),
      },
    ];
  });
}

function toMethod(value: unknown): {id: string; sensitivity: 'read' | 'write'}[] {
  if (!isRecord(value) || !isString(value.id) || !isSensitivity(value.sensitivity)) return [];
  return [{id: value.id, sensitivity: value.sensitivity}];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSensitivity(value: unknown): value is 'read' | 'write' {
  return value === 'read' || value === 'write';
}

function toolStepActionTools(tool: Record<string, unknown>): IntegrationActionTool[] {
  const {
    provider,
    connection_id: connectionId,
    connection_slug: connectionSlug,
    id,
    sensitivity,
  } = tool;
  if (
    !isString(provider) ||
    !isString(connectionId) ||
    !isString(connectionSlug) ||
    !isString(id) ||
    !isSensitivity(sensitivity)
  )
    return [];
  const method = isString(tool.method) ? tool.method : null;
  return [
    {
      provider,
      connectionId,
      connectionSlug,
      toolId: id,
      sensitivity,
      ...(method ? {methods: [{id: method, sensitivity}]} : {}),
    },
  ];
}
