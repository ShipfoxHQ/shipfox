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
import {loadLinearRecordings} from './linear-recordings.js';

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

  it('puts a created issue without a team in the default team', async () => {
    const mock = await startLinearMcpMock({endpoint: new URL('http://127.0.0.1:0/mcp')});
    const client = new Client({name: 'linear-mcp-test', version: '0.0.0'});
    const transport = new StreamableHTTPClientTransport(mock.endpoint);

    try {
      await client.connect(transport as unknown as Transport);
      await client.callTool(
        {name: 'save_issue', arguments: {title: 'No team'}},
        CallToolResultSchema,
      );

      expect(mock.writes()).toEqual([
        {kind: 'save_issue', target: 'ENG', payload: {title: 'No team'}},
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

describe('Linear MCP mock with recordings', () => {
  async function connect(endpoint: URL) {
    const client = new Client({name: 'linear-recordings-test', version: '0.0.0'});
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: {headers: {authorization: 'Bearer synthetic-linear-token'}},
    });
    await client.connect(transport as unknown as Transport);
    return client;
  }

  it('replays the content blocks of every recorded call', async () => {
    const recordings = await loadLinearRecordings();
    const mock = await startLinearMcpMock({
      endpoint: new URL('http://127.0.0.1:0/mcp'),
      recordings,
    });
    const client = await connect(mock.endpoint);

    try {
      expect(recordings).toHaveLength(31);
      for (const recording of recordings) {
        const result = await client.callTool(
          {name: recording.tool, arguments: recording.arguments},
          CallToolResultSchema,
        );

        expect(result.content, recording.tool).toEqual(recording.result.content);
        expect(result.structuredContent, recording.tool).toBeUndefined();
        expect(result.isError === true, recording.tool).toBe(recording.result.isError === true);
      }
    } finally {
      await client.close();
      await mock.stop();
    }
  });

  it('fails a call whose arguments were not recorded, or that adds a field', async () => {
    const mock = await startLinearMcpMock({
      endpoint: new URL('http://127.0.0.1:0/mcp'),
      recordings: await loadLinearRecordings(),
    });
    const client = await connect(mock.endpoint);

    try {
      const result = await client.callTool(
        {name: 'get_issue', arguments: {id: 'SAR-999999'}},
        CallToolResultSchema,
      );

      const extraField = await client.callTool(
        {name: 'get_issue', arguments: {id: 'SAR-5', extra: 'field'}},
        CallToolResultSchema,
      );

      expect(result.isError).toBe(true);
      expect(extraField.isError).toBe(true);
    } finally {
      await client.close();
      await mock.stop();
    }
  });
});
