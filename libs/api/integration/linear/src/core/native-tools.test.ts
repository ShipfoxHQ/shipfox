import type {LinearRelationEdge, LinearRelationEdgePage} from '#api/client.js';
import {LinearIntegrationProviderError} from '#core/errors.js';
import {callLinearNativeTool, isLinearNativeTool} from '#core/native-tools.js';

function edge(identifier: string, type = 'related'): LinearRelationEdge {
  return {
    cursor: `cursor-${identifier}`,
    type,
    issue: {
      id: `uuid-${identifier}`,
      identifier,
      title: `Issue ${identifier}`,
      projectId: 'project-1',
      archivedAt: null,
    },
  };
}

function edgePage(edges: LinearRelationEdge[], hasNextPage = false): LinearRelationEdgePage {
  return {edges, hasNextPage, endCursor: edges.at(-1)?.cursor ?? null};
}

function relation(identifier: string, type: string, direction: 'outgoing' | 'incoming') {
  return {
    type,
    direction,
    issue: {
      id: `uuid-${identifier}`,
      identifier,
      title: `Issue ${identifier}`,
      projectId: 'project-1',
      archivedAt: null,
    },
  };
}

function nativeContext() {
  const linear = {listIssueRelations: vi.fn(), listIssueAttachments: vi.fn()};
  return {linear, context: {linear, accessToken: 'linear-token'}};
}

describe('Linear native tools', () => {
  it('routes only the native tool ids', () => {
    expect(isLinearNativeTool('list_issue_relations')).toBe(true);
    expect(isLinearNativeTool('list_issue_attachments')).toBe(true);
    expect(isLinearNativeTool('get_issue')).toBe(false);
    expect(isLinearNativeTool('toString')).toBe(false);
  });

  describe('list_issue_relations', () => {
    it('returns outgoing then incoming relations with their project', async () => {
      const {linear, context} = nativeContext();
      linear.listIssueRelations.mockResolvedValue({
        outgoing: edgePage([edge('ENG-2', 'blocks')]),
        incoming: edgePage([edge('ENG-3', 'duplicate'), edge('ENG-4', 'blocks')]),
      });

      const result = await callLinearNativeTool(
        {toolId: 'list_issue_relations', arguments: {issueId: 'ENG-1'}},
        context,
      );

      expect(result.structuredContent).toEqual({
        relations: [
          relation('ENG-2', 'blocks', 'outgoing'),
          relation('ENG-3', 'duplicate', 'incoming'),
          relation('ENG-4', 'blocks', 'incoming'),
        ],
        hasNextPage: false,
        cursor: null,
      });
      expect(result.content).toEqual([
        {type: 'text', text: JSON.stringify(result.structuredContent)},
      ]);
      expect(linear.listIssueRelations).toHaveBeenCalledWith({
        accessToken: 'linear-token',
        issueId: 'ENG-1',
        outgoing: {first: 50, after: undefined},
        incoming: {first: 50, after: undefined},
      });
    });

    it('pages through outgoing relations, then continues incoming from the last one returned', async () => {
      const {linear, context} = nativeContext();
      linear.listIssueRelations
        .mockResolvedValueOnce({
          outgoing: edgePage([edge('ENG-2'), edge('ENG-3')], true),
          incoming: edgePage([edge('ENG-9')]),
        })
        .mockResolvedValueOnce({
          outgoing: edgePage([edge('ENG-4')]),
          incoming: edgePage([edge('ENG-5'), edge('ENG-6')], true),
        })
        .mockResolvedValueOnce({
          incoming: edgePage([edge('ENG-6'), edge('ENG-7')]),
        });
      const call = (cursor?: string) =>
        callLinearNativeTool(
          {
            toolId: 'list_issue_relations',
            arguments: {issueId: 'ENG-1', limit: 2, ...(cursor === undefined ? {} : {cursor})},
          },
          context,
        );

      const first = await call();
      const second = await call(first.structuredContent?.cursor as string);
      const third = await call(second.structuredContent?.cursor as string);

      expect(first.structuredContent).toMatchObject({
        relations: [
          relation('ENG-2', 'related', 'outgoing'),
          relation('ENG-3', 'related', 'outgoing'),
        ],
        hasNextPage: true,
      });
      expect(second.structuredContent).toMatchObject({
        relations: [
          relation('ENG-4', 'related', 'outgoing'),
          relation('ENG-5', 'related', 'incoming'),
        ],
        hasNextPage: true,
      });
      expect(third.structuredContent).toEqual({
        relations: [
          relation('ENG-6', 'related', 'incoming'),
          relation('ENG-7', 'related', 'incoming'),
        ],
        hasNextPage: false,
        cursor: null,
      });
      expect(linear.listIssueRelations.mock.calls.map(([input]) => input)).toEqual([
        expect.objectContaining({
          outgoing: {first: 2, after: undefined},
          incoming: {first: 2, after: undefined},
        }),
        expect.objectContaining({
          outgoing: {first: 2, after: 'cursor-ENG-3'},
          incoming: {first: 2, after: undefined},
        }),
        {
          accessToken: 'linear-token',
          issueId: 'ENG-1',
          incoming: {first: 2, after: 'cursor-ENG-5'},
        },
      ]);
    });

    it('starts incoming relations from the beginning when outgoing ones fill the page', async () => {
      const {linear, context} = nativeContext();
      linear.listIssueRelations
        .mockResolvedValueOnce({
          outgoing: edgePage([edge('ENG-2')]),
          incoming: edgePage([edge('ENG-3')]),
        })
        .mockResolvedValueOnce({incoming: edgePage([edge('ENG-3')])});
      const call = (cursor?: string) =>
        callLinearNativeTool(
          {
            toolId: 'list_issue_relations',
            arguments: {issueId: 'ENG-1', limit: 1, ...(cursor === undefined ? {} : {cursor})},
          },
          context,
        );

      const first = await call();
      const second = await call(first.structuredContent?.cursor as string);

      expect(first.structuredContent).toMatchObject({
        relations: [relation('ENG-2', 'related', 'outgoing')],
        hasNextPage: true,
      });
      expect(second.structuredContent).toEqual({
        relations: [relation('ENG-3', 'related', 'incoming')],
        hasNextPage: false,
        cursor: null,
      });
      expect(linear.listIssueRelations).toHaveBeenLastCalledWith({
        accessToken: 'linear-token',
        issueId: 'ENG-1',
        incoming: {first: 1, after: undefined},
      });
    });

    it('rejects a cursor it did not issue', async () => {
      const {linear, context} = nativeContext();

      const result = await callLinearNativeTool(
        {toolId: 'list_issue_relations', arguments: {issueId: 'ENG-1', cursor: 'not-a-cursor'}},
        context,
      );

      expect(result).toEqual({
        isError: true,
        content: [{type: 'text', text: 'The cursor is not a list_issue_relations cursor.'}],
        structuredContent: {code: 'invalid-request'},
      });
      expect(linear.listIssueRelations).not.toHaveBeenCalled();
    });
  });

  describe('list_issue_attachments', () => {
    it('returns Linear page cursors until the last page', async () => {
      const {linear, context} = nativeContext();
      const attachment = {
        id: 'attachment-1',
        title: 'design.pdf',
        subtitle: null,
        url: 'https://uploads.linear.app/org/file/design.pdf',
        createdAt: '2026-09-27T12:00:00.000Z',
      };
      linear.listIssueAttachments
        .mockResolvedValueOnce({attachments: [attachment], hasNextPage: true, endCursor: 'page-2'})
        .mockResolvedValueOnce({attachments: [], hasNextPage: false, endCursor: 'page-2'});

      const first = await callLinearNativeTool(
        {toolId: 'list_issue_attachments', arguments: {issueId: 'ENG-1', limit: 1}},
        context,
      );
      const last = await callLinearNativeTool(
        {toolId: 'list_issue_attachments', arguments: {issueId: 'ENG-1', cursor: 'page-2'}},
        context,
      );

      expect(first.structuredContent).toEqual({
        attachments: [attachment],
        hasNextPage: true,
        cursor: 'page-2',
      });
      expect(last.structuredContent).toEqual({attachments: [], hasNextPage: false, cursor: null});
      expect(linear.listIssueAttachments).toHaveBeenLastCalledWith({
        accessToken: 'linear-token',
        issueId: 'ENG-1',
        first: 50,
        after: 'page-2',
      });
    });
  });

  it.each([
    [
      'a missing issue id',
      {},
      'Invalid issueId: Invalid input: expected string, received undefined',
    ],
    ['a limit above the Linear maximum', {issueId: 'ENG-1', limit: 251}],
    ['a fractional limit', {issueId: 'ENG-1', limit: 1.5}],
    ['an unknown argument', {issueId: 'ENG-1', includeArchived: true}],
  ])('rejects %s as an invalid request', async (_name, arguments_, message?: string) => {
    const {linear, context} = nativeContext();

    const result = await callLinearNativeTool(
      {toolId: 'list_issue_attachments', arguments: arguments_},
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({code: 'invalid-request'});
    if (message !== undefined) expect(result.content).toEqual([{type: 'text', text: message}]);
    expect(linear.listIssueAttachments).not.toHaveBeenCalled();
  });

  it.each([
    [
      new LinearIntegrationProviderError('not-found', 'Linear could not find the issue.'),
      {code: 'not-found'},
    ],
    [
      new LinearIntegrationProviderError(
        'rate-limited',
        'Linear request was rate limited',
        30,
        429,
      ),
      {code: 'rate-limited', retryAfterSeconds: 30, status: 429},
    ],
  ])('returns Linear provider errors as coded tool errors', async (error, structuredContent) => {
    const {linear, context} = nativeContext();
    linear.listIssueRelations.mockRejectedValue(error);

    const result = await callLinearNativeTool(
      {toolId: 'list_issue_relations', arguments: {issueId: 'ENG-1'}},
      context,
    );

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: error.message}],
      structuredContent,
    });
  });

  it('rethrows unexpected failures for the gateway to report', async () => {
    const {linear, context} = nativeContext();
    const failure = new Error('unexpected');
    linear.listIssueAttachments.mockRejectedValue(failure);

    const result = callLinearNativeTool(
      {toolId: 'list_issue_attachments', arguments: {issueId: 'ENG-1'}},
      context,
    );

    await expect(result).rejects.toBe(failure);
  });
});
