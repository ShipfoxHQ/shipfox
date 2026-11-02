import {createLinearAgentSessionAcknowledger} from './agent-session-acknowledgement.js';

describe('createLinearAgentSessionAcknowledger', () => {
  it('posts a thought activity to the session within a timeout shorter than Linear’s 10 seconds', async () => {
    const createAgentActivity = vi.fn(() => Promise.resolve());
    const getAccessToken = vi.fn(() => Promise.resolve('linear-token'));
    const acknowledge = createLinearAgentSessionAcknowledger({
      linear: {createAgentActivity},
      tokenStore: {getAccessToken},
    });

    await acknowledge({connectionId: 'connection-1', agentSessionId: 'session-1'});

    expect(getAccessToken).toHaveBeenCalledWith({connectionId: 'connection-1'});
    expect(createAgentActivity).toHaveBeenCalledWith({
      accessToken: 'linear-token',
      agentSessionId: 'session-1',
      content: {type: 'thought', body: expect.any(String)},
      timeoutMs: expect.any(Number),
    });
    const [{timeoutMs}] = createAgentActivity.mock.calls[0] as unknown as [{timeoutMs: number}];
    expect(timeoutMs).toBeLessThan(10_000);
  });
});
