import type {ActionPresentation, ActionPresentationLookup, PairedAction} from './activity.js';

export interface IntegrationActionTool {
  provider: string;
  connectionId: string;
  connectionSlug: string;
  toolId: string;
  sensitivity: 'read' | 'write';
  methods?: readonly {id: string; sensitivity: 'read' | 'write'}[] | undefined;
}

const CLAUDE_PREFIX = 'mcp__shipfox_integration_tools__';

/** Exact exposed names avoid mistaking an arbitrary connection slug for a provider. */
export function createIntegrationActionPresentationLookup(
  tools: readonly IntegrationActionTool[],
): ActionPresentationLookup {
  const byName = new Map<string, IntegrationActionTool | null>();
  for (const tool of tools) {
    const name = `${tool.connectionSlug.replaceAll('-', '_')}__${tool.toolId}`;
    byName.set(name, byName.has(name) ? null : tool);
  }

  return (action): ActionPresentation | undefined => {
    if (!action.request) return undefined;
    const exposedName = action.request.name;
    const name = exposedName.startsWith(CLAUDE_PREFIX)
      ? exposedName.slice(CLAUDE_PREFIX.length)
      : exposedName;
    const tool = byName.get(name);
    if (!tool) return undefined;

    return presentIntegrationAction(tool, action.request, action.result);
  };
}

function presentIntegrationAction(
  tool: IntegrationActionTool,
  request: NonNullable<PairedAction['request']>,
  result: PairedAction['result'],
): ActionPresentation {
  const input = parseObject(request.input);
  const methodId = tool.methods ? stringValue(input?.method) : null;
  const method = tool.methods?.find((candidate) => candidate.id === methodId);
  const classification = tool.methods ? (method?.sensitivity ?? 'unknown') : tool.sensitivity;
  const output = parseJson(result?.output);
  return {
    label: humanize(method ? `${tool.toolId} ${method.id}` : tool.toolId),
    target: primaryIdentifier(input) ?? primaryIdentifier(asRecord(output)),
    iconKind: 'integration',
    detailKind: 'structured',
    readClassification: classification,
    statusDetail: result?.isError ? undefined : itemCount(output),
    detail: result ? {label: 'Result', value: result.output, kind: 'structured'} : null,
    integration: {
      provider: tool.provider,
      connectionId: tool.connectionId,
      connectionSlug: tool.connectionSlug,
      toolId: tool.toolId,
      methodId: method?.id ?? null,
    },
  };
}

function parseObject(value: string | undefined): Record<string, unknown> | null {
  return asRecord(parseJson(value));
}

function parseJson(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function itemCount(output: unknown): string | undefined {
  const record = asRecord(output);
  const items = Array.isArray(output)
    ? output
    : (record?.items ?? record?.results ?? record?.matches);
  if (!Array.isArray(items)) return undefined;
  return `${items.length} ${items.length === 1 ? 'item' : 'items'}`;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function primaryIdentifier(value: Record<string, unknown> | null): string | null {
  if (!value) return null;
  for (const key of ['identifier', 'issue_key', 'key', 'path', 'title', 'name', 'query']) {
    const text = stringValue(value[key]);
    if (text) return text;
  }
  const number = value.issue_number ?? value.pull_number ?? value.pr_number ?? value.number;
  if (typeof number === 'number' || typeof number === 'string') {
    const owner = stringValue(value.owner);
    const repo = stringValue(value.repo);
    return owner && repo ? `${owner}/${repo}#${number}` : `#${number}`;
  }
  return null;
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
