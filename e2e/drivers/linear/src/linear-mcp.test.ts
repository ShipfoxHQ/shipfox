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
    const mock = await startLinearMcpMock({endpoint: new URL('http://127.0.0.1:0/mcp')});
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

      const transition = await client.callTool(
        {name: 'save_issue', arguments: {id: 'ENG-878', state: 'started'}},
        CallToolResultSchema,
      );

      expect(transition.content).toContainEqual({type: 'text', text: LINEAR_WRITE_RESULT_MARKER});
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
        {
          authorization: 'Bearer synthetic-linear-token',
          arguments: {id: 'ENG-878', state: 'started'},
          toolName: 'save_issue',
        },
      ]);
      expect(mock.writes()).toEqual([
        {
          kind: 'save_comment',
          target: 'ENG-878',
          payload: {issueId: 'ENG-878', body: 'Synthetic Linear comment'},
        },
        {kind: 'save_issue', target: 'ENG-878', payload: {id: 'ENG-878', state: 'started'}},
      ]);
    } finally {
      await client.close();
      await mock.stop();
    }
  });

  it('creates issues from a save_issue without an id and records them against their team', async () => {
    const mock = await startLinearMcpMock({endpoint: new URL('http://127.0.0.1:0/mcp')});
    const client = new Client({name: 'linear-mcp-test', version: '0.0.0'});
    const transport = new StreamableHTTPClientTransport(mock.endpoint);
    const input = {
      team: 'ENG',
      title: 'Retry webhook delivery',
      links: [{title: 'Slack thread', url: 'https://e2e.slack.com/archives/C1/p1'}],
    };

    try {
      await client.connect(transport as unknown as Transport);
      const first = await client.callTool(
        {name: 'save_issue', arguments: input},
        CallToolResultSchema,
      );
      const second = await client.callTool(
        {name: 'save_issue', arguments: input},
        CallToolResultSchema,
      );

      expect(first.content).toEqual([
        {
          type: 'text',
          text: JSON.stringify({
            id: 'ENG-101',
            title: 'Retry webhook delivery',
            url: 'https://linear.app/e2e/issue/ENG-101',
          }),
        },
      ]);
      expect(second.content).toEqual([
        {
          type: 'text',
          text: JSON.stringify({
            id: 'ENG-102',
            title: 'Retry webhook delivery',
            url: 'https://linear.app/e2e/issue/ENG-102',
          }),
        },
      ]);
      expect(mock.writes()).toEqual([
        {kind: 'save_issue', target: 'ENG', payload: input},
        {kind: 'save_issue', target: 'ENG', payload: input},
      ]);
    } finally {
      await client.close();
      await mock.stop();
    }
  });

  it('serves uploads to bearer-authenticated requests', async () => {
    const mock = await startLinearMcpMock({endpoint: new URL('http://127.0.0.1:0/mcp')});
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
    const startingMock = startLinearMcpMock({endpoint});

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

  it('serves a fixture workspace in pages, with not-found errors', async () => {
    const mock = await startLinearMcpMock({
      endpoint: new URL('http://127.0.0.1:0/mcp'),
      workspace: {
        issues: {
          'ENG-1': {id: 'ENG-1', title: 'Root', projectId: 'project-1'},
          'ENG-2': {id: 'ENG-2', title: 'Child', projectId: 'project-1', parentId: 'ENG-1'},
          'ENG-3': {id: 'ENG-3', title: 'Elsewhere', projectId: 'project-2'},
          'ENG-4': {id: 'ENG-4', title: 'Sibling', projectId: 'project-1'},
        },
        documents: {},
        comments: {},
      },
    });
    const client = new Client({name: 'linear-mcp-test', version: '0.0.0'});
    const transport = new StreamableHTTPClientTransport(mock.endpoint);
    const call = async (name: string, arguments_: Record<string, unknown>) => {
      const result = await client.callTool({name, arguments: arguments_}, CallToolResultSchema);
      const [block] = result.content as {type: string; text?: string}[];
      return {isError: result.isError === true, body: JSON.parse(block?.text ?? 'null') as unknown};
    };

    try {
      await client.connect(transport as unknown as Transport);
      const firstPage = await call('list_issues', {project: 'project-1'});
      const secondPage = await call('list_issues', {project: 'project-1', cursor: '2'});
      const children = await call('list_issues', {parentId: 'ENG-1'});
      const missing = await call('get_issue', {id: 'ENG-404'});

      expect(firstPage.body).toEqual({
        issues: [
          {id: 'ENG-1', title: 'Root', projectId: 'project-1'},
          {id: 'ENG-2', title: 'Child', projectId: 'project-1'},
        ],
        hasNextPage: true,
        cursor: '2',
      });
      expect(secondPage.body).toEqual({
        issues: [{id: 'ENG-4', title: 'Sibling', projectId: 'project-1'}],
        hasNextPage: false,
      });
      expect(children.body).toMatchObject({issues: [{id: 'ENG-2'}], hasNextPage: false});
      expect(missing).toMatchObject({isError: true, body: {error: 'invalid_request'}});
    } finally {
      await client.close();
      await mock.stop();
    }
  });
});
