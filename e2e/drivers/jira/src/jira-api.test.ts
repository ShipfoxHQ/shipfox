import {startJiraApiMock} from './jira-api.js';

const REST = '/ex/jira/cloud-1/rest/api/3';

describe('Jira API mock', () => {
  it('fails fast when the endpoint omits a port', async () => {
    await expect(startJiraApiMock(new URL('http://127.0.0.1'))).rejects.toThrow(
      'JIRA_API_BASE_URL must include an explicit port for the Jira API mock',
    );
  });

  it('fails fast when the endpoint includes a path prefix', async () => {
    await expect(startJiraApiMock(new URL('http://127.0.0.1:9000/jira'))).rejects.toThrow(
      'JIRA_API_BASE_URL must not include a path for the Jira API mock',
    );
  });

  it('records reads as calls only', async () => {
    const mock = await startJiraApiMock(new URL('http://127.0.0.1:0'));

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

  it('records each write with its target and body', async () => {
    const mock = await startJiraApiMock(new URL('http://127.0.0.1:0'));
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
    const mock = await startJiraApiMock(new URL('http://127.0.0.1:0'));

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
    const mock = await startJiraApiMock(new URL('http://127.0.0.1:0'));

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
});
