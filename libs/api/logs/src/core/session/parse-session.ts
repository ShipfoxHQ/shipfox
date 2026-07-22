import type {SessionViewRow} from '@shipfox/api-logs-dto';
import type {Harness} from '@shipfox/workflow-document';
import {parseClaudeSessionRecord} from './claude-parser.js';
import {parsePiSessionRecord} from './pi-parser.js';
import type {AgentSessionRecord} from './session-record.js';

export function parseSessionRecord(
  record: AgentSessionRecord,
  harness: Harness,
): readonly SessionViewRow[] {
  try {
    return harness === 'claude' ? parseClaudeSessionRecord(record) : parsePiSessionRecord(record);
  } catch {
    return [
      {
        kind: 'raw',
        timestamp: record.ts,
        label: 'Unsupported session entry',
        raw: record.data,
      },
    ];
  }
}
