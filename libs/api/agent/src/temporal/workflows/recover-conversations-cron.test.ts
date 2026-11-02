import {recoverConversationsCron} from './recover-conversations-cron.js';

const mocks = vi.hoisted(() => ({
  recoverConversations: vi.fn(),
  logInfo: vi.fn(),
  proxyOptions: undefined as {retry?: {maximumAttempts?: number}} | undefined,
}));

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: (options: typeof mocks.proxyOptions) => {
    mocks.proxyOptions = options;
    return {recoverConversations: mocks.recoverConversations};
  },
  log: {info: mocks.logInfo},
}));

describe('recoverConversationsCron', () => {
  beforeEach(() => {
    mocks.recoverConversations.mockReset();
    mocks.logInfo.mockReset();
    mocks.recoverConversations.mockResolvedValue({woken: 0});
  });

  it('runs the sweep once per firing, because the next firing is the retry', () => {
    expect(mocks.proxyOptions?.retry?.maximumAttempts).toBe(1);
  });

  it('logs when the tick woke conversations', async () => {
    mocks.recoverConversations.mockResolvedValue({woken: 3});

    await recoverConversationsCron();

    expect(mocks.recoverConversations).toHaveBeenCalledOnce();
    expect(mocks.logInfo).toHaveBeenCalledWith('Woke agent conversations with pending work', {
      woken: 3,
    });
  });

  it('stays silent when nothing was pending', async () => {
    await recoverConversationsCron();

    expect(mocks.recoverConversations).toHaveBeenCalledOnce();
    expect(mocks.logInfo).not.toHaveBeenCalled();
  });
});
