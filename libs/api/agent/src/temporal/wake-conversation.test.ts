import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {wakeConversation} from './wake-conversation.js';

vi.mock('@shipfox/node-temporal', () => ({temporalClient: vi.fn()}));

const MESSAGE_CONTENT_PATTERN = /body|content|text/;

describe('wakeConversation', () => {
  const signalWithStart = vi.fn();

  beforeEach(() => {
    signalWithStart.mockReset();
    vi.mocked(temporalClient).mockReturnValue({workflow: {signalWithStart}} as never);
  });

  it('signals the conversation workflow, and starts it when none runs', async () => {
    signalWithStart.mockResolvedValue(undefined);

    await wakeConversation('conversation-1');

    expect(signalWithStart).toHaveBeenCalledExactlyOnceWith('agentConversationWorkflow', {
      taskQueue: 'agent-conversation',
      workflowId: 'agent-conversation:conversation-1',
      args: [{conversationId: 'conversation-1'}],
      signal: 'wake',
    });
  });

  it('carries no message content to Temporal', async () => {
    signalWithStart.mockResolvedValue(undefined);

    await wakeConversation('conversation-1');

    expect(JSON.stringify(signalWithStart.mock.calls)).not.toMatch(MESSAGE_CONTENT_PATTERN);
  });

  it('logs a failed signal and never fails the caller', async () => {
    const warn = vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
    signalWithStart.mockRejectedValue(new Error('Temporal is down'));

    await expect(wakeConversation('conversation-1')).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({conversationId: 'conversation-1'}),
      'Failed to wake an agent conversation',
    );
  });

  it('does not fail the caller when no Temporal client exists', async () => {
    vi.mocked(temporalClient).mockImplementation(() => {
      throw new Error('Temporal client has not been created');
    });

    await expect(wakeConversation('conversation-1')).resolves.toBeUndefined();
  });
});
