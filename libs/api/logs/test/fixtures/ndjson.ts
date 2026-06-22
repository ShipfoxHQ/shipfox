import {Buffer} from 'node:buffer';

export function outputLine(data: string, stream: 'stdout' | 'stderr' = 'stdout'): string {
  return `${JSON.stringify({v: 1, ts: 1, type: 'output', stream, data})}\n`;
}

export function recordLine(fields: Record<string, unknown>): string {
  return `${JSON.stringify({v: 1, ts: 1, ...fields})}\n`;
}

export function endLine(totalBytes: number): string {
  return recordLine({type: 'end', total_bytes: totalBytes});
}

export function sessionLine(data: string): string {
  return recordLine({type: 'agent_session', data});
}

export function groupStartLine(
  groupId: string,
  name: string,
  parentGroupId: string | null = null,
): string {
  return recordLine({type: 'group_start', group_id: groupId, parent_group_id: parentGroupId, name});
}

export function ndjsonBody(...lines: string[]): Buffer {
  return Buffer.from(lines.join(''), 'utf8');
}

/** A single output record whose decoded `data` payload is exactly `payloadBytes` ASCII bytes. */
export function outputOfBytes(payloadBytes: number): Buffer {
  return ndjsonBody(outputLine('x'.repeat(payloadBytes)));
}
