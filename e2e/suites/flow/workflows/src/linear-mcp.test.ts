import {once} from 'node:events';
import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {
  LINEAR_READ_RESULT_MARKER,
  LINEAR_WRITE_RESULT_MARKER,
  startLinearMcpMock,
} from './linear-mcp.js';

describe('Linear MCP mock', () => {
  it('serves deterministic authenticated read and write tool calls', async () => {
    const mock = await startLinearMcpMock(new URL('http://127.0.0.1:0/mcp'));
    const client = new Client({name: 'linear-mcp-test', version: '0.0.0'});
    const transport = new StreamableHTTPClientTransport(mock.endpoint, {
      requestInit: {headers: {authorization: 'Bearer synthetic-linear-token'}},
    });

    try {
      await client.connect(transport as unknown as Transport);
      const read = await client.callTool(
        {name: 'get_issue', arguments: {id: 'ENG-878'}},
        CallToolResultSchema,
      );
      const write = await client.callTool(
        {
          name: 'save_comment',
          arguments: {issueId: 'ENG-878', body: 'Synthetic Linear comment'},
        },
        CallToolResultSchema,
      );

      expect(read.content).toContainEqual({type: 'text', text: LINEAR_READ_RESULT_MARKER});
      expect(write.content).toContainEqual({type: 'text', text: LINEAR_WRITE_RESULT_MARKER});
      expect(mock.calls).toEqual([
        {
          authorization: 'Bearer synthetic-linear-token',
          arguments: {id: 'ENG-878'},
          toolName: 'get_issue',
        },
        {
          authorization: 'Bearer synthetic-linear-token',
          arguments: {issueId: 'ENG-878', body: 'Synthetic Linear comment'},
          toolName: 'save_comment',
        },
      ]);
    } finally {
      await client.close();
      await mock.stop();
    }
  });

  it('fails clearly when its endpoint port is occupied', async () => {
    const occupied = createServer();
    occupied.listen({host: '127.0.0.1', port: 0});
    await once(occupied, 'listening');
    const address = occupied.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');

    try {
      await expect(
        startLinearMcpMock(new URL(`http://127.0.0.1:${address.port}/mcp`)),
      ).rejects.toThrow('Linear MCP mock failed to start');
    } finally {
      occupied.close();
      await once(occupied, 'close');
    }
  });
});
