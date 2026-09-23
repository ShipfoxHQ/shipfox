import type {ActionPresentation, PairedAction} from './activity.js';

/** Pi exposes the output tool directly; Claude reaches it through the runner's MCP server. */
const outputToolNames: ReadonlySet<string> = new Set([
  'set_output',
  'mcp__shipfox_outputs__set_output',
]);

/** Pi records a rejected output as plain retry guidance without an error flag. */
const OUTPUT_REJECTION_MARKER = 'Retry set_output';

/** Returns no presentation when the name is not a Shipfox-owned tool or its input is unreadable. */
export function shipfoxActionPresentation(action: PairedAction): ActionPresentation | undefined {
  const request = action.request;
  if (!request || !outputToolNames.has(request.name)) return undefined;
  const input = parseObject(request.input);
  const key = typeof input?.key === 'string' && input.key.trim() ? input.key.trim() : null;
  if (key === null) return undefined;
  const value = typeof input?.value === 'string' ? input.value : null;
  const output = action.result?.output;
  return {
    label: 'Set Output',
    target: key,
    iconKind: 'output',
    detailKind: 'code',
    readClassification: 'write',
    statusDetail: output !== undefined && isOutputRejection(output) ? 'rejected' : undefined,
    detail: value === null ? null : {label: 'Value', value, kind: 'code'},
  };
}

export function shipfoxOutputRejected(name: string, output: string): boolean {
  return outputToolNames.has(name) && isOutputRejection(output);
}

function isOutputRejection(output: string): boolean {
  return output.includes(OUTPUT_REJECTION_MARKER);
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
