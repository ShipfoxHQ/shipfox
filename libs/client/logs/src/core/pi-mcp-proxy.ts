import type {ActionPresentation, PairedAction} from './activity.js';

/** Pi's discovery surface routes every integration call through one `mcp` meta-tool. */
const PI_MCP_PROXY_TOOL_NAME = 'mcp';

/**
 * Rewrites a proxied call so downstream lookups see the inner tool name and arguments, as if
 * the tool had been exposed directly. Returns null for direct calls and non-call proxy uses.
 */
export function unwrapPiMcpProxyAction(action: PairedAction): PairedAction | null {
  const request = action.request;
  if (!request || request.name !== PI_MCP_PROXY_TOOL_NAME) return null;
  const input = parseObject(request.input);
  const tool = typeof input?.tool === 'string' ? input.tool.trim() : '';
  if (!input || !tool) return null;
  return {
    ...action,
    request: {...request, name: tool, input: proxiedArguments(input.args)},
  };
}

/** Presents the proxy's own search form; other proxy actions keep the generic fallback. */
export function piMcpProxySearchPresentation(action: PairedAction): ActionPresentation | undefined {
  const request = action.request;
  if (!request || request.name !== PI_MCP_PROXY_TOOL_NAME) return undefined;
  const input = parseObject(request.input);
  const search = typeof input?.search === 'string' ? input.search.trim() : '';
  if (!search) return undefined;
  const output = action.result?.output;
  return {
    label: 'Search Tools',
    target: search,
    iconKind: 'search',
    detailKind: 'code',
    readClassification: 'read',
    detail: output === undefined ? null : {label: 'Result', value: output, kind: 'code'},
  };
}

function proxiedArguments(value: unknown): string {
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value === undefined ? {} : value);
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
