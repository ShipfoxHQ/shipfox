import {describe, expect, it, vi} from '@shipfox/vitest/vi';
import {createSimulatedUser, type SimulatorMessagesApi} from './simulated-user.js';

function fakeApi(replies: string[]) {
  const create = vi.fn<SimulatorMessagesApi['create']>();
  for (const text of replies) {
    create.mockResolvedValueOnce({
      content: [{type: 'text', text}],
      usage: {input_tokens: 10, output_tokens: 3},
    });
  }
  return create;
}

describe('createSimulatedUser', () => {
  it('answers from the persona and reports usage', async () => {
    const create = fakeApi(['Linear, team ENG.']);
    const user = createSimulatedUser({persona: 'You use Linear, team ENG.', messages: {create}});

    const answer = await user.answer('Which tracker do you use?');

    expect(answer).toEqual({
      text: 'Linear, team ENG.',
      usage: {input_tokens: 10, output_tokens: 3},
    });
    const call = create.mock.calls[0]?.[0];
    expect(call?.system).toContain('You use Linear, team ENG.');
    expect(call?.messages).toEqual([{role: 'user', content: 'Which tracker do you use?'}]);
  });

  it('keeps the conversation so later answers stay consistent', async () => {
    const create = fakeApi(['Linear.', 'Yes.']);
    const user = createSimulatedUser({persona: 'p', messages: {create}});

    await user.answer('Which tracker?');
    await user.answer('Draft PRs?');

    expect(create.mock.calls[1]?.[0].messages).toEqual([
      {role: 'user', content: 'Which tracker?'},
      {role: 'assistant', content: 'Linear.'},
      {role: 'user', content: 'Draft PRs?'},
    ]);
  });

  it('passes the cancellation signal to the API call', async () => {
    const create = fakeApi(['Linear.']);
    const user = createSimulatedUser({persona: 'p', messages: {create}});
    const controller = new AbortController();

    await user.answer('Which tracker?', {signal: controller.signal});

    expect(create.mock.calls[0]?.[1]).toEqual({signal: controller.signal});
  });

  it('fails on an empty answer instead of sending nothing to the agent', async () => {
    const user = createSimulatedUser({persona: 'p', messages: {create: fakeApi([' '])}});

    await expect(user.answer('Which tracker?')).rejects.toThrow('empty answer');
  });
});
