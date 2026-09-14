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
});
