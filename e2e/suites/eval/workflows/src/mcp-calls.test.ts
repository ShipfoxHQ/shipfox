import {describe, expect, it} from '@shipfox/vitest/vi';
import {buildCallRecords} from './mcp-calls.js';

function record(httpStatus: number) {
  return buildCallRecords({
    sessionId: 'session-1',
    requestBody: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {name: 'list_projects', arguments: {}},
    }),
    responseBody: JSON.stringify({jsonrpc: '2.0', id: 1, result: {content: []}}),
    responseContentType: 'application/json',
    httpStatus,
    startedAt: 0,
    finishedAt: 5,
  })[0];
}

describe('MCP call records', () => {
  it('records a matched result as ok when the HTTP call succeeded', () => {
    expect(record(200)?.status).toBe('ok');
  });

  it('records an error when the HTTP call failed, even if the body holds a result', () => {
    expect(record(500)).toMatchObject({status: 'error', httpStatus: 500});
  });
});
