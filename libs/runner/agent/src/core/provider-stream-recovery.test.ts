import {
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Model,
} from '@earendil-works/pi-ai';
import {
  isManagedProviderStreamInterruption,
  PROVIDER_STREAM_INTERRUPTED_RETRY_MESSAGE,
  wrapManagedProviderStream,
} from './provider-stream-recovery.js';

const model = {
  api: 'openai-responses',
  provider: 'shipfox',
  id: 'managed-model',
} as Model<'openai-responses'>;
const context: Context = {messages: []};

function assistantMessage(errorMessage: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
    },
    stopReason: 'error',
    errorMessage,
    timestamp: Date.now(),
  };
}

describe('managed provider stream recovery', () => {
  it('requires the managed provider, error stop reason, and exact trimmed message', () => {
    expect(
      isManagedProviderStreamInterruption('shipfox', 'error', '  Stream error occurred\n'),
    ).toBe(true);
    expect(isManagedProviderStreamInterruption('openai', 'error', 'Stream error occurred')).toBe(
      false,
    );
    expect(isManagedProviderStreamInterruption('shipfox', 'stop', 'Stream error occurred')).toBe(
      false,
    );
    expect(
      isManagedProviderStreamInterruption('shipfox', 'error', 'stream error occurred again'),
    ).toBe(false);
  });

  it('does not override a structured non-retryable response', () => {
    expect(
      isManagedProviderStreamInterruption(
        'shipfox',
        'error',
        '{"code":"unauthorized","message":"Stream error occurred"}',
      ),
    ).toBe(false);
  });

  it('normalizes only the matching final error event', async () => {
    const source = createAssistantMessageEventStream();
    const stream = wrapManagedProviderStream(() => source)(model, context);
    const events: unknown[] = [];
    const consuming = (async () => {
      for await (const event of stream) events.push(event);
    })();

    source.push({type: 'start', partial: assistantMessage('')});
    source.push({
      type: 'error',
      reason: 'error',
      error: assistantMessage('  Stream error occurred  '),
    });
    await consuming;

    expect(events).toEqual([
      {type: 'start', partial: assistantMessage('')},
      {
        type: 'error',
        reason: 'error',
        error: assistantMessage(PROVIDER_STREAM_INTERRUPTED_RETRY_MESSAGE),
      },
    ]);
  });
});
