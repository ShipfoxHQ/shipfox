import type {LogRecord} from '@shipfox/api-logs-dto';
import {expandSessionRecord} from './selector.js';

describe('expandSessionRecord', () => {
  it('returns the canonical row stored on the log record', () => {
    const record: Extract<LogRecord, {type: 'agent_session'}> = {
      v: 1,
      ts: 1,
      type: 'agent_session',
      row: {
        kind: 'message',
        timestamp: 1,
        role: 'assistant',
        label: 'assistant',
        meta: [],
        text: 'hello',
        terminalFailure: false,
      },
    };

    const rows = expandSessionRecord(record);

    expect(rows).toEqual([record.row]);
  });
});
