import {startClickUpApiMock} from './clickup-api.js';

describe('ClickUp API mock', () => {
  it('fails fast when the endpoint omits a port', async () => {
    await expect(startClickUpApiMock(new URL('http://127.0.0.1'))).rejects.toThrow(
      'CLICKUP_API_BASE_URL must include an explicit port for the ClickUp API mock',
    );
  });

  it('allows an explicit port 0 for ephemeral test endpoints', async () => {
    const mock = await startClickUpApiMock(new URL('http://127.0.0.1:0'));

    try {
      expect(mock.endpoint.port).not.toBe('0');
    } finally {
      await mock.stop();
    }
  });

  it('fails fast when the endpoint includes a path prefix', async () => {
    await expect(startClickUpApiMock(new URL('http://127.0.0.1:9000/clickup'))).rejects.toThrow(
      'CLICKUP_API_BASE_URL must not include a path for the ClickUp API mock',
    );
  });

  it('logs malformed requests before returning a bounded error', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const mock = await startClickUpApiMock(new URL('http://127.0.0.1:0'));

    try {
      const response = await fetch(new URL('/api/v2/task/e2e/comment', mock.endpoint), {
        method: 'POST',
        body: '{',
      });

      expect(response.status).toBe(400);
      expect(stderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('ClickUp API mock request failed: SyntaxError:'),
      );
    } finally {
      stderrWrite.mockRestore();
      await mock.stop();
    }
  });
});
