import type {ActionPresentation, ActionPresentationLookup, PairedAction} from './activity.js';

export interface IntegrationActionTool {
  provider: string;
  connectionId: string;
  connectionSlug: string;
  toolId: string;
  sensitivity: 'read' | 'write';
  methods?: readonly {id: string; sensitivity: 'read' | 'write'}[] | undefined;
  /**
   * Set for action steps. Their rows name each call `<alias>__<tool>`, as the action code called
   * it, because two aliases can bind the same connection.
   */
  alias?: string | undefined;
  /** A `file` tool records the downloaded file's metadata as its result. */
  result?: 'json' | 'file' | undefined;
}

const CLAUDE_PREFIX = 'mcp__shipfox_integration_tools__';

/** Exact exposed names avoid mistaking an arbitrary connection slug for a provider. */
export function createIntegrationActionPresentationLookup(
  tools: readonly IntegrationActionTool[],
): ActionPresentationLookup {
  const byName = new Map<string, IntegrationActionTool | null>();
  for (const tool of tools) {
    const prefix = tool.alias ?? tool.connectionSlug.replaceAll('-', '_');
    const name = `${prefix}__${tool.toolId}`;
    byName.set(name, byName.has(name) ? null : tool);
  }

  return (action): ActionPresentation | undefined => {
    if (!action.request) return undefined;
    const exposedName = action.request.name;
    const name = exposedName.startsWith(CLAUDE_PREFIX)
      ? exposedName.slice(CLAUDE_PREFIX.length)
      : exposedName;
    const tool = byName.get(name);
    if (tool) {
      return isActionTool(tool)
        ? presentActionCall({tool, action, methodId: null})
        : presentIntegrationAction(tool, action.request, action.result);
    }

    // Action code calls a family method as `family.method`.
    const methodSeparator = name.indexOf('.');
    if (methodSeparator === -1) return undefined;
    const family = byName.get(name.slice(0, methodSeparator));
    if (!family || !isActionTool(family) || !family.methods) return undefined;
    return presentActionCall({tool: family, action, methodId: name.slice(methodSeparator + 1)});
  };
}

function isActionTool(
  tool: IntegrationActionTool,
): tool is IntegrationActionTool & {alias: string} {
  return tool.alias !== undefined;
}

function presentActionCall({
  tool,
  action,
  methodId,
}: {
  tool: IntegrationActionTool & {alias: string};
  action: PairedAction;
  methodId: string | null;
}): ActionPresentation {
  const input = parseObject(action.request?.input);
  const output = parseJson(action.result?.output);
  const method = tool.methods?.find((candidate) => candidate.id === methodId);
  const failure = action.result?.isError ? asRecord(output) : null;
  const file = tool.result === 'file' && !action.result?.isError ? downloadedFile(output) : null;
  return {
    label: humanize(method ? `${tool.toolId} ${method.id}` : tool.toolId),
    target: file?.filename ?? primaryIdentifier(input),
    iconKind: 'integration',
    detailKind: 'structured',
    readClassification: tool.methods ? (method?.sensitivity ?? 'unknown') : tool.sensitivity,
    statusDetail: file ? formatBytes(file.bytes) : undefined,
    outcome: actionCallOutcome(action.state, failure),
    meta: [
      {label: 'Alias', value: tool.alias},
      {label: 'Connection', value: tool.connectionSlug},
    ],
    // Without a presented detail the row shows both the arguments and the result.
    ...(file
      ? {
          detail: {
            label: 'Downloaded file',
            value: JSON.stringify({
              File: file.filename,
              Size: formatBytes(file.bytes),
              'Media type': file.mediaType,
              'SHA-256': file.sha256,
              Path: file.path,
            }),
            kind: 'structured' as const,
          },
        }
      : {}),
    integration: {
      provider: tool.provider,
      connectionId: tool.connectionId,
      connectionSlug: tool.connectionSlug,
      toolId: tool.toolId,
      methodId: method?.id ?? null,
    },
  };
}

function actionCallOutcome(
  state: PairedAction['state'],
  failure: Record<string, unknown> | null,
): ActionPresentation['outcome'] {
  // Failed action calls record the local endpoint's error, which flags a write that may have landed.
  if (failure?.outcome_unknown === true) return {label: 'outcome unknown', tone: 'warning'};
  // The step ended while the call was open: cancellation or a timeout stopped it.
  if (state === 'no-result') return {label: 'interrupted', tone: 'neutral'};
  return undefined;
}

interface DownloadedFile {
  path: string;
  filename: string;
  bytes: number;
  mediaType: string;
  sha256: string;
}

function downloadedFile(value: unknown): DownloadedFile | null {
  const record = asRecord(value);
  if (!record) return null;
  const {path, filename, bytes, media_type: mediaType, sha256} = record;
  if (
    typeof path !== 'string' ||
    typeof filename !== 'string' ||
    typeof bytes !== 'number' ||
    typeof mediaType !== 'string' ||
    typeof sha256 !== 'string'
  ) {
    return null;
  }
  return {path, filename, bytes, mediaType, sha256};
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
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
  for (const key of ['identifier', 'issue_key', 'idOrKey', 'task_id', 'channel_id', 'key']) {
    const text = stringValue(value[key]);
    if (text) return text;
  }
  const numberedTarget = repositoryNumberTarget(value);
  if (numberedTarget) return numberedTarget;
  for (const key of [
    'path',
    'title',
    'name',
    'query',
    'repository',
    'repo',
    'list_id',
    'project_id',
    'id',
  ]) {
    const text = stringValue(value[key]);
    if (text) return text;
  }
  return null;
}

function repositoryNumberTarget(value: Record<string, unknown>): string | null {
  const number =
    value.issue_number ?? value.pull_number ?? value.pr_number ?? value.index ?? value.number;
  if (typeof number !== 'number' && !stringValue(number)) return null;
  const owner = stringValue(value.owner);
  const repo = stringValue(value.repo) ?? stringValue(value.repository);
  const repository = owner && repo ? `${owner}/${repo}` : repo;
  return repository ? `${repository}#${number}` : `#${number}`;
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
