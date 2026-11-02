import {recoverConversationsCron} from './recover-conversations-cron.js';

const mocks = vi.hoisted(() => ({
  recoverConversations: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: () => ({recoverConversations: mocks.recoverConversations}),
  log: {info: mocks.logInfo},
}));

describe('recoverConversationsCron', () => {
  beforeEach(() => {
    mocks.recoverConversations.mockReset();
    mocks.logInfo.mockReset();
    mocks.recoverConversations.mockResolvedValue({woken: 0});
  });

  it('logs when the tick woke conversations', async () => {
    mocks.recoverConversations.mockResolvedValue({woken: 3});

    await recoverConversationsCron();

    expect(mocks.logInfo).toHaveBeenCalledWith('Woke agent conversations with pending work', {
      woken: 3,
    });
  });

  it('stays silent when nothing was pending', async () => {
    await recoverConversationsCron();

    expect(mocks.logInfo).not.toHaveBeenCalled();
  });
});
