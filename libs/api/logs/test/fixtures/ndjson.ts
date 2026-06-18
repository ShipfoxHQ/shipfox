import {Buffer} from 'node:buffer';

export function outputLine(data: string): string {
  return `${JSON.stringify({v: 1, ts: 1, type: 'output', data})}\n`;
}

export function controlLine(fields: Record<string, unknown>): string {
  return `${JSON.stringify({v: 1, ts: 1, type: 'control', ...fields})}\n`;
}

export function ndjsonBody(...lines: string[]): Buffer {
  return Buffer.from(lines.join(''), 'utf8');
}

/** A single output record whose decoded `data` payload is exactly `payloadBytes` ASCII bytes. */
export function outputOfBytes(payloadBytes: number): Buffer {
  return ndjsonBody(outputLine('x'.repeat(payloadBytes)));
}
