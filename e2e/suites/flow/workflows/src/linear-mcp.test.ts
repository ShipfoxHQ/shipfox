import {once} from 'node:events';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {
  LINEAR_READ_RESULT_MARKER,
  LINEAR_UPLOAD_FIXTURES,
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

  it('serves uploads to bearer-authenticated requests', async () => {
    const mock = await startLinearMcpMock(new URL('http://127.0.0.1:0/mcp'));
    const url = new URL('e2e-org/report/report.pdf?signature=signed', mock.uploadsUrl);

    try {
      const unauthenticated = await fetch(url);
      const missing = await fetch(new URL('e2e-org/missing', mock.uploadsUrl), {
        headers: {authorization: 'Bearer synthetic-linear-token'},
      });
      const response = await fetch(url, {
        headers: {authorization: 'Bearer synthetic-linear-token'},
      });

      expect(unauthenticated.status).toBe(401);
      expect(missing.status).toBe(404);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/pdf');
      expect(response.headers.get('content-disposition')).toBe('attachment; filename="report.pdf"');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(
        LINEAR_UPLOAD_FIXTURES['e2e-org/report/report.pdf']?.body,
      );
      expect(mock.uploads.at(-1)).toEqual({
        authorization: 'Bearer synthetic-linear-token',
        path: '/uploads/e2e-org/report/report.pdf',
      });
    } finally {
      await mock.stop();
    }
  });

  it('waits for an occupied endpoint port to become available', async () => {
    const occupied = createServer();
    occupied.listen({host: '127.0.0.1', port: 0});
    await once(occupied, 'listening');
    const address = occupied.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
    const endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);
    let mock: Awaited<ReturnType<typeof startLinearMcpMock>> | undefined;
    let occupiedClosed = false;
    const startingMock = startLinearMcpMock(endpoint);

    try {
      await expect(
        Promise.race([startingMock.then(() => 'started'), delay(250, 'waiting')]),
      ).resolves.toBe('waiting');

      occupied.close();
      await once(occupied, 'close');
      occupiedClosed = true;
      mock = await startingMock;

      expect(mock.endpoint).toEqual(endpoint);
    } finally {
      if (!occupiedClosed) {
        occupied.close();
        await once(occupied, 'close');
      }
      mock ??= await startingMock.catch(() => undefined);
      await mock?.stop();
    }
  });
});
