import {JIRA_IN_PROGRESS_TRANSITION_ID, startJiraApiMock} from './jira-api.js';

const REST = '/ex/jira/cloud-1/rest/api/3';

describe('Jira API mock', () => {
  it('fails fast when the endpoint omits a port', async () => {
    await expect(startJiraApiMock({endpoint: new URL('http://127.0.0.1')})).rejects.toThrow(
      'JIRA_API_BASE_URL must include an explicit port for the Jira API mock',
    );
  });

  it('fails fast when the endpoint includes a path prefix', async () => {
    await expect(
      startJiraApiMock({endpoint: new URL('http://127.0.0.1:9000/jira')}),
    ).rejects.toThrow('JIRA_API_BASE_URL must not include a path for the Jira API mock');
  });

  it('records reads as calls only', async () => {
    const mock = await startJiraApiMock({endpoint: new URL('http://127.0.0.1:0')});

    try {
      const response = await fetch(new URL(`${REST}/issue/ENG-1?fields=summary`, mock.endpoint), {
        headers: {authorization: 'Bearer token-1'},
      });

      expect(response.status).toBe(200);
      expect(mock.calls).toEqual([
        {
          kind: 'get_issue',
          authorization: 'Bearer token-1',
          cloudId: 'cloud-1',
          idOrKey: 'ENG-1',
          query: {fields: 'summary'},
        },
      ]);
      expect(mock.writes()).toEqual([]);
    } finally {
      await mock.stop();
    }
  });

  it('keeps every value of a repeated query parameter', async () => {
    const mock = await startJiraApiMock({endpoint: new URL('http://127.0.0.1:0')});

    try {
      await fetch(
        new URL(`${REST}/issue/ENG-1?fields=summary&fields=status&expand=names`, mock.endpoint),
      );

      expect(mock.calls[0]).toMatchObject({
        query: {fields: ['summary', 'status'], expand: 'names'},
      });
    } finally {
      await mock.stop();
    }
  });

  it.each([
    {kind: 'search_issues', method: 'POST', path: '/search/jql', body: {jql: 'project = ENG'}},
    {kind: 'get_issue_comments', method: 'GET', path: '/issue/ENG-1/comment'},
    {kind: 'get_issue_transitions', method: 'GET', path: '/issue/ENG-1/transitions'},
    {kind: 'get_project', method: 'GET', path: '/project/ENG'},
    {kind: 'get_user', method: 'GET', path: '/user?accountId=acct-1'},
  ])('serves and records $kind as a read', async ({kind, method, path, body}) => {
    const mock = await startJiraApiMock({endpoint: new URL('http://127.0.0.1:0')});

    try {
      const response = await fetch(new URL(`${REST}${path}`, mock.endpoint), {
        method,
        ...(body === undefined
          ? {}
          : {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}),
      });

      expect(response.status).toBe(200);
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0]).toMatchObject({kind, cloudId: 'cloud-1'});
      expect(mock.writes()).toEqual([]);
    } finally {
      await mock.stop();
    }
  });

  it('records each write with its target and body', async () => {
    const mock = await startJiraApiMock({endpoint: new URL('http://127.0.0.1:0')});
    const send = (method: string, path: string, body: unknown) =>
      fetch(new URL(`${REST}${path}`, mock.endpoint), {
        method,
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(body),
      });

    try {
      const created = await send('POST', '/issue', {fields: {project: {key: 'ENG'}}});
      const commented = await send('POST', '/issue/ENG-1/comment', {body: {type: 'doc'}});
      const transitioned = await send('POST', '/issue/ENG-1/transitions', {transition: {id: '31'}});
      const assigned = await send('PUT', '/issue/ENG-1/assignee', {accountId: 'acct-1'});
      const updated = await send('PUT', '/issue/ENG-1', {fields: {summary: 'New'}});

      expect(created.status).toBe(201);
      expect(commented.status).toBe(201);
      expect([transitioned.status, assigned.status, updated.status]).toEqual([204, 204, 204]);
      expect(mock.writes()).toEqual([
        {kind: 'create_issue', target: 'ENG', payload: {fields: {project: {key: 'ENG'}}}},
        {kind: 'add_comment', target: 'ENG-1', payload: {body: {type: 'doc'}}},
        {kind: 'transition_issue', target: 'ENG-1', payload: {transition: {id: '31'}}},
        {kind: 'assign_issue', target: 'ENG-1', payload: {accountId: 'acct-1'}},
        {kind: 'update_issue', target: 'ENG-1', payload: {fields: {summary: 'New'}}},
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('answers unknown paths with 404 and known paths with the wrong method with 405', async () => {
    const mock = await startJiraApiMock({endpoint: new URL('http://127.0.0.1:0')});

    try {
      const unknown = await fetch(new URL(`${REST}/dashboard`, mock.endpoint));
      const wrongMethod = await fetch(new URL(`${REST}/project/ENG`, mock.endpoint), {
        method: 'DELETE',
      });

      expect(unknown.status).toBe(404);
      expect(wrongMethod.status).toBe(405);
      expect(mock.calls).toEqual([]);
    } finally {
      await mock.stop();
    }
  });

  it('logs malformed requests before returning a bounded error', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const mock = await startJiraApiMock({endpoint: new URL('http://127.0.0.1:0')});

    try {
      const response = await fetch(new URL(`${REST}/issue/ENG-1/comment`, mock.endpoint), {
        method: 'POST',
        body: '{',
      });

      expect(response.status).toBe(400);
      expect(stderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('Jira API mock request failed: SyntaxError:'),
      );
    } finally {
      stderrWrite.mockRestore();
      await mock.stop();
    }
  });

  it('serves the issue status and an in-progress transition for status-aware workflows', async () => {
    const mock = await startJiraApiMock({endpoint: new URL('http://127.0.0.1:0')});

    try {
      const issue = (await (
        await fetch(new URL(`${REST}/issue/ENG-1?fields=status`, mock.endpoint))
      ).json()) as {fields: {status: {statusCategory: {key: string}}}};
      const {transitions} = (await (
        await fetch(new URL(`${REST}/issue/ENG-1/transitions`, mock.endpoint))
      ).json()) as {
        transitions: Array<{id: string; to: {statusCategory: {key: string}}}>;
      };

      expect(issue.fields.status.statusCategory.key).toBe('new');
      expect(
        transitions.find((transition) => transition.to.statusCategory.key === 'indeterminate')?.id,
      ).toBe(JIRA_IN_PROGRESS_TRANSITION_ID);
    } finally {
      await mock.stop();
    }
  });
  describe('seeded objects', () => {
    async function arrangeSeeded() {
      const mock = await startJiraApiMock({endpoint: new URL('http://127.0.0.1:0')});
      mock.seed({
        projects: [{key: 'SEED', id: '10001', name: 'Seeded project'}],
        issues: [{key: 'SEED-1', id: '10010', summary: 'Seeded issue'}],
        comments: [{issueKey: 'SEED-1', id: '10000', body: 'Seeded comment'}],
        users: [{accountId: 'acct-1', displayName: 'Seeded User'}],
      });
      const get = async (path: string, init?: RequestInit) =>
        (await (await fetch(new URL(`${REST}${path}`, mock.endpoint), init)).json()) as Record<
          string,
          unknown
        >;
      return {mock, get};
    }

    it('serves a seeded issue by its key or its ID', async () => {
      const {mock, get} = await arrangeSeeded();

      try {
        const expected = {
          id: '10010',
          key: 'SEED-1',
          fields: {summary: 'Seeded issue', project: {key: 'SEED'}},
        };
        expect(await get('/issue/SEED-1')).toMatchObject(expected);
        expect(await get('/issue/10010')).toMatchObject(expected);
      } finally {
        await mock.stop();
      }
    });

    it('searches the seeded issues, and keeps the generic one when nothing is seeded', async () => {
      const {mock} = await arrangeSeeded();
      const bare = await startJiraApiMock({endpoint: new URL('http://127.0.0.1:0')});
      const search = (url: URL) =>
        fetch(new URL(`${REST}/search/jql`, url), {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({jql: 'project = SEED'}),
        }).then((response) => response.json() as Promise<{issues: Array<{key: string}>}>);

      try {
        expect((await search(mock.endpoint)).issues.map(({key}) => key)).toEqual(['SEED-1']);
        expect((await search(bare.endpoint)).issues.map(({key}) => key)).toEqual(['E2E-1']);
      } finally {
        await mock.stop();
        await bare.stop();
      }
    });

    it('serves the seeded comments of an issue as ADF documents', async () => {
      const {mock, get} = await arrangeSeeded();

      try {
        expect(await get('/issue/SEED-1/comment')).toEqual({
          startAt: 0,
          maxResults: 50,
          total: 1,
          comments: [
            {
              id: '10000',
              body: {
                type: 'doc',
                version: 1,
                content: [{type: 'paragraph', content: [{type: 'text', text: 'Seeded comment'}]}],
              },
            },
          ],
        });
        expect(await get('/issue/OTHER-1/comment')).toMatchObject({total: 0, comments: []});
      } finally {
        await mock.stop();
      }
    });

    it('serves a seeded project by its key or its ID, and a seeded user by account ID', async () => {
      const {mock, get} = await arrangeSeeded();

      try {
        const project = {id: '10001', key: 'SEED', name: 'Seeded project'};
        expect(await get('/project/SEED')).toEqual(project);
        expect(await get('/project/10001')).toEqual(project);
        expect(await get('/user?accountId=acct-1')).toEqual({
          accountId: 'acct-1',
          displayName: 'Seeded User',
        });
      } finally {
        await mock.stop();
      }
    });
  });

  describe('stateful writes', () => {
    async function arrange() {
      const mock = await startJiraApiMock({endpoint: new URL('http://127.0.0.1:0')});
      mock.seed({
        projects: [{key: 'WRITE', id: '10002', name: 'Write project'}],
        issues: [{key: 'WRITE-1', id: '10010', summary: 'Seeded issue'}],
        users: [{accountId: 'acct-1', displayName: 'Seeded User'}],
      });
      const send = (method: string, path: string, body?: unknown) =>
        fetch(new URL(`${REST}${path}`, mock.endpoint), {
          method,
          ...(body === undefined
            ? {}
            : {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}),
        });
      const get = async (path: string) => (await (await send('GET', path)).json()) as JiraJson;
      return {mock, send, get};
    }

    interface JiraJson {
      id: string;
      key: string;
      transitions: Array<{id: string}>;
    }
    const description = {
      type: 'doc',
      version: 1,
      content: [{type: 'paragraph', content: [{type: 'text', text: 'Details'}]}],
    };

    it('serves a created issue by its key and its ID, in the project of the create', async () => {
      const {mock, send, get} = await arrange();

      try {
        const created = (await (
          await send('POST', '/issue', {
            fields: {
              project: {id: '10002'},
              summary: 'Created',
              description,
              labels: ['one'],
              issuetype: {name: 'Task'},
            },
          })
        ).json()) as JiraJson;

        expect(created).toMatchObject({key: 'WRITE-2'});
        const expected = {
          id: created.id,
          key: 'WRITE-2',
          fields: {
            summary: 'Created',
            description,
            labels: ['one'],
            assignee: null,
            issuetype: {name: 'Task'},
            project: {key: 'WRITE'},
            status: {name: 'To Do', statusCategory: {key: 'new'}},
          },
        };
        expect(await get('/issue/WRITE-2')).toEqual(expected);
        expect(await get(`/issue/${created.id}`)).toEqual(expected);
        const next = (await (
          await send('POST', '/issue', {fields: {project: {key: 'WRITE'}}})
        ).json()) as JiraJson;
        expect(next.key).toBe('WRITE-3');
        expect(next.id).not.toBe(created.id);
      } finally {
        await mock.stop();
      }
    });

    it('applies an update to the fields it sends and keeps the others', async () => {
      const {mock, send, get} = await arrange();

      try {
        await send('PUT', '/issue/WRITE-1', {fields: {summary: 'Renamed', description}});
        await send('PUT', '/issue/WRITE-1', {fields: {labels: ['two'], priority: {name: 'High'}}});

        expect(await get('/issue/WRITE-1')).toMatchObject({
          fields: {summary: 'Renamed', description, labels: ['two'], priority: {name: 'High'}},
        });
      } finally {
        await mock.stop();
      }
    });

    it('lists the comments an issue received, as ADF documents', async () => {
      const {mock, send, get} = await arrange();

      try {
        const comment = (await (
          await send('POST', '/issue/WRITE-1/comment', {body: description})
        ).json()) as JiraJson;

        expect(comment).toMatchObject({body: description});
        expect(await get('/issue/WRITE-1/comment')).toMatchObject({
          total: 1,
          comments: [{id: comment.id, body: description}],
        });
      } finally {
        await mock.stop();
      }
    });

    it('assigns and unassigns an issue', async () => {
      const {mock, send, get} = await arrange();

      try {
        await send('PUT', '/issue/WRITE-1/assignee', {accountId: 'acct-1'});
        expect(await get('/issue/WRITE-1')).toMatchObject({
          fields: {assignee: {accountId: 'acct-1', displayName: 'Seeded User'}},
        });

        await send('PUT', '/issue/WRITE-1/assignee', {accountId: null});
        expect(await get('/issue/WRITE-1')).toMatchObject({fields: {assignee: null}});
      } finally {
        await mock.stop();
      }
    });

    it('moves the status with a transition and offers the other two from there', async () => {
      const {mock, send, get} = await arrange();
      const offered = async () =>
        (await get('/issue/WRITE-1/transitions')).transitions.map(({id}) => id);

      try {
        expect(await offered()).toEqual(['21', '31']);

        const response = await send('POST', '/issue/WRITE-1/transitions', {transition: {id: '31'}});

        expect(response.status).toBe(204);
        expect(await get('/issue/WRITE-1')).toMatchObject({
          fields: {status: {name: 'Done', statusCategory: {key: 'done'}}},
        });
        expect(await offered()).toEqual(['11', '21']);
      } finally {
        await mock.stop();
      }
    });

    it('rejects a transition the issue cannot take, and keeps its status', async () => {
      const {mock, send, get} = await arrange();

      try {
        const unknown = await send('POST', '/issue/WRITE-1/transitions', {transition: {id: '99'}});
        const sameStatus = await send('POST', '/issue/WRITE-1/transitions', {
          transition: {id: '11'},
        });

        expect([unknown.status, sameStatus.status]).toEqual([400, 400]);
        expect(await get('/issue/WRITE-1')).toMatchObject({fields: {status: {name: 'To Do'}}});
      } finally {
        await mock.stop();
      }
    });

    it('accepts a write to an issue it does not keep, and changes nothing', async () => {
      const {mock, send, get} = await arrange();

      try {
        const responses = await Promise.all([
          send('PUT', '/issue/OTHER-1', {fields: {summary: 'Renamed'}}),
          send('POST', '/issue/OTHER-1/transitions', {transition: {id: '31'}}),
          send('PUT', '/issue/OTHER-1/assignee', {accountId: 'acct-1'}),
        ]);

        expect(responses.map(({status}) => status)).toEqual([204, 204, 204]);
        expect(await get('/issue/OTHER-1')).toMatchObject({
          fields: {summary: 'E2E Jira issue', status: {name: 'To Do'}},
        });
      } finally {
        await mock.stop();
      }
    });

    it('searches the created issues after the seeded ones', async () => {
      const {mock, send} = await arrange();

      try {
        await send('POST', '/issue', {fields: {project: {key: 'WRITE'}, summary: 'Created'}});
        const search = (await (
          await send('POST', '/search/jql', {jql: 'project = WRITE'})
        ).json()) as {
          issues: Array<{key: string}>;
        };

        expect(search.issues.map(({key}) => key)).toEqual(['WRITE-1', 'WRITE-2']);
      } finally {
        await mock.stop();
      }
    });
  });
});
