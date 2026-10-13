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
import {loadLinearRecordings, loadLinearWriteRecordings} from './linear-recordings.js';

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

describe('Linear MCP mock with write recordings', () => {
  const WRITE_TEAM = '9356e9c7-94d5-444d-83eb-d54b22c8082c';

  async function start() {
    const mock = await startLinearMcpMock({
      endpoint: new URL('http://127.0.0.1:0/mcp'),
      recordings: await loadLinearRecordings(),
      writeRecordings: await loadLinearWriteRecordings(),
    });
    const client = new Client({name: 'linear-writes-test', version: '0.0.0'});
    await client.connect(
      new StreamableHTTPClientTransport(mock.endpoint, {
        requestInit: {headers: {authorization: 'Bearer synthetic-linear-token'}},
      }) as unknown as Transport,
    );
    const call = async (name: string, arguments_: Record<string, unknown>) => {
      const result = await client.callTool({name, arguments: arguments_}, CallToolResultSchema);
      const [block] = result.content as {type: string; text?: string}[];
      return {
        isError: result.isError === true,
        body: JSON.parse(block?.text ?? 'null') as Record<string, unknown>,
      };
    };
    const stop = async () => {
      await client.close();
      await mock.stop();
    };
    return {mock, call, stop};
  }

  it('records one write per tool, in the order and fields of the hosted MCP', async () => {
    const recordings = await loadLinearWriteRecordings();
    const {call, stop} = await start();

    try {
      expect(recordings.map((recording) => recording.tool).sort()).toEqual([
        'create_attachment',
        'create_attachment_from_upload',
        'create_issue_label',
        'delete_attachment',
        'delete_comment',
        'delete_status_update',
        'prepare_attachment_upload',
        'save_comment',
        'save_document',
        'save_issue',
        'save_milestone',
        'save_project',
        'save_status_update',
      ]);
      const issue = await call('save_issue', {team: WRITE_TEAM, title: 'Keys'});
      const recorded = recordings.find((recording) => recording.tool === 'save_issue');
      expect(Object.keys(issue.body)).toEqual(
        Object.keys(JSON.parse(String(recorded?.result.content[0]?.text))),
      );
    } finally {
      await stop();
    }
  });

  it('returns an issue after it is created, changed, and canceled', async () => {
    const {mock, call, stop} = await start();

    try {
      const created = await call('save_issue', {
        team: WRITE_TEAM,
        title: 'Contract run',
        description: 'Created.',
      });
      const id = created.body.id as string;
      await call('save_issue', {id, title: 'Contract run updated', description: 'Updated.'});
      await call('save_issue', {id, state: 'Canceled'});
      const read = await call('get_issue', {id});
      const second = await call('save_issue', {team: WRITE_TEAM, title: 'Second'});

      expect(id).toBe('SAW-101');
      expect(second.body.id).toBe('SAW-102');
      expect(read.body).toMatchObject({
        id,
        uuid: created.body.uuid,
        title: 'Contract run updated',
        description: 'Updated.',
        status: 'Canceled',
        statusType: 'canceled',
        teamId: WRITE_TEAM,
        attachments: [],
      });
      expect(read.body.canceledAt).toEqual(expect.any(String));
      expect(await call('get_issue', {id: created.body.uuid})).toMatchObject({
        body: {id},
      });
      expect(mock.writes().map((write) => [write.kind, write.target])).toEqual([
        ['save_issue', WRITE_TEAM],
        ['save_issue', id],
        ['save_issue', id],
        ['save_issue', WRITE_TEAM],
      ]);
    } finally {
      await stop();
    }
  });

  it('lists, changes, and deletes the comments of a created issue', async () => {
    const {call, stop} = await start();

    try {
      const issue = await call('save_issue', {team: WRITE_TEAM, title: 'Comments'});
      const issueId = issue.body.id as string;
      const comment = await call('save_comment', {issueId, body: 'First'});
      await call('save_comment', {id: comment.body.id, issueId, body: 'First updated'});
      const listed = await call('list_comments', {issueId});
      const deleted = await call('delete_comment', {id: comment.body.id});
      const empty = await call('list_comments', {issueId});

      expect(listed.body.comments).toEqual([
        expect.objectContaining({id: comment.body.id, body: 'First updated'}),
      ]);
      expect(deleted.body).toEqual({success: true});
      expect(empty.body).toEqual({comments: [], hasNextPage: false});
    } finally {
      await stop();
    }
  });

  it('attaches, uploads, and removes attachments on a created issue', async () => {
    const {call, stop} = await start();

    try {
      const issue = await call('save_issue', {team: WRITE_TEAM, title: 'Attachments'});
      const issueId = issue.body.id as string;
      const attachment = await call('create_attachment', {
        issue: issueId,
        title: 'Attached',
        filename: 'contract.txt',
        contentType: 'text/plain',
        base64Content: 'aGVsbG8=',
        sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      });
      const prepared = await call('prepare_attachment_upload', {
        issue: issueId,
        title: 'Uploaded',
        filename: 'contract.txt',
        contentType: 'text/plain',
        size: 5,
      });
      const early = await call('create_attachment_from_upload', {
        issue: issueId,
        assetUrl: 'https://uploads.linear.app/other',
        title: 'Uploaded',
      });
      const finalized = await call('create_attachment_from_upload', {
        issue: issueId,
        assetUrl: prepared.body.assetUrl,
        title: 'Uploaded',
      });
      const withBoth = await call('get_issue', {id: issueId});
      await call('delete_attachment', {id: attachment.body.id});
      await call('delete_attachment', {id: finalized.body.id});
      const without = await call('get_issue', {id: issueId});

      expect(prepared.body).toMatchObject({
        issueId: issue.body.uuid,
        uploadRequest: {method: 'PUT', headers: {'x-goog-content-length-range': '5,5'}},
        finalize: {input: {issue: issueId, assetUrl: prepared.body.assetUrl}},
      });
      expect(early.isError).toBe(true);
      expect(withBoth.body.attachments).toEqual([
        expect.objectContaining({id: attachment.body.id, title: 'Attached'}),
        expect.objectContaining({id: finalized.body.id, title: 'Uploaded'}),
      ]);
      expect(without.body.attachments).toEqual([]);
    } finally {
      await stop();
    }
  });

  it('returns documents, labels, and projects with their milestones and status updates', async () => {
    const {call, stop} = await start();

    try {
      const document = await call('save_document', {
        team: WRITE_TEAM,
        title: 'Doc',
        content: 'One',
      });
      await call('save_document', {id: document.body.id, content: 'Two'});
      const label = await call('create_issue_label', {name: 'Contract label', color: '#4EA7FC'});
      const project = await call('save_project', {
        name: 'Contract project',
        addTeams: [WRITE_TEAM],
        summary: 'Created.',
      });
      await call('save_project', {id: project.body.uuid, summary: 'Updated.'});
      const milestone = await call('save_milestone', {
        project: project.body.uuid,
        name: 'Milestone',
      });
      await call('save_milestone', {
        project: project.body.uuid,
        id: milestone.body.id,
        name: 'Milestone updated',
      });
      const update = await call('save_status_update', {
        type: 'project',
        project: project.body.uuid,
        body: 'On track.',
        health: 'onTrack',
      });
      await call('save_status_update', {
        type: 'project',
        id: update.body.id,
        health: 'atRisk',
      });
      const listed = await call('get_status_updates', {
        type: 'project',
        project: project.body.uuid,
      });
      await call('delete_status_update', {type: 'project', id: update.body.id});
      const canceled = await call('save_project', {id: project.body.uuid, state: 'canceled'});

      expect((await call('get_document', {id: document.body.id})).body).toMatchObject({
        title: 'Doc',
        content: 'Two',
      });
      expect(
        (await call('list_issue_labels', {name: 'Contract label', limit: 1})).body.labels,
      ).toEqual([expect.objectContaining({id: label.body.id, color: '#4EA7FC'})]);
      expect(project.body.id).toBe('P-SAW-101');
      expect(
        (await call('get_milestone', {project: project.body.uuid, query: milestone.body.id})).body,
      ).toMatchObject({name: 'Milestone updated'});
      expect(listed.body.statusUpdates).toEqual([
        expect.objectContaining({body: 'On track.', health: 'atRisk'}),
      ]);
      expect(
        (await call('get_status_updates', {type: 'project', project: project.body.uuid})).body,
      ).toEqual({statusUpdates: [], hasNextPage: false});
      expect((await call('get_project', {query: project.body.uuid})).body).toMatchObject({
        summary: 'Updated.',
        status: {name: 'Canceled', type: 'canceled'},
        teams: [{id: WRITE_TEAM, key: 'SAW'}],
      });
      expect(canceled.body.canceledAt).toEqual(expect.any(String));
    } finally {
      await stop();
    }
  });

  it('keeps replaying the recorded reads of the sandbox workspace', async () => {
    const recordings = await loadLinearRecordings();
    const {call, stop} = await start();

    try {
      const recorded = recordings.find((recording) => recording.tool === 'get_issue');
      const result = await call('get_issue', recorded?.arguments ?? {});

      expect(result.body).toEqual(JSON.parse(String(recorded?.result.content[0]?.text)));
    } finally {
      await stop();
    }
  });

  it('fails a write it cannot apply, and leaves it out of the writes', async () => {
    const {mock, call, stop} = await start();

    try {
      const issue = await call('save_issue', {team: WRITE_TEAM, title: 'Unsupported'});
      const assigned = await call('save_issue', {id: issue.body.id, assignee: 'me'});
      const missing = await call('save_comment', {issueId: 'SAW-999', body: 'Lost'});
      const unknownTeam = await call('save_issue', {team: 'NOPE', title: 'Lost'});
      const unknownState = await call('save_issue', {id: issue.body.id, state: 'Nowhere'});

      expect(assigned).toMatchObject({isError: true});
      expect(assigned.body.message).toContain('assignee');
      expect(missing.isError).toBe(true);
      expect(unknownTeam.isError).toBe(true);
      expect(unknownState.isError).toBe(true);
      expect(mock.calls).toHaveLength(5);
      expect(mock.writes()).toHaveLength(1);
    } finally {
      await stop();
    }
  });
});
