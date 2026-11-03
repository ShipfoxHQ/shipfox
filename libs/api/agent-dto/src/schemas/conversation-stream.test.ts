import {
  conversationStreamEventSchema,
  conversationStreamQuerySchema,
} from './conversation-stream.js';

const uuid = '11111111-1111-4111-8111-111111111111';

describe('conversationStreamQuerySchema', () => {
  it('starts from the beginning when the client sends no cursor', () => {
    const parsed = conversationStreamQuerySchema.parse({});

    expect(parsed).toEqual({after_seq: 0});
  });

  it('coerces the cursor from the query string', () => {
    const parsed = conversationStreamQuerySchema.parse({after_seq: '12'});

    expect(parsed).toEqual({after_seq: 12});
  });

  it.each([
    {name: 'a negative cursor', query: {after_seq: '-1'}},
    {name: 'a cursor past int4', query: {after_seq: '2147483648'}},
    {name: 'a fractional cursor', query: {after_seq: '1.5'}},
  ])('rejects $name', ({query}) => {
    const parse = () => conversationStreamQuerySchema.parse(query);

    expect(parse).toThrow();
  });
});

describe('conversationStreamEventSchema', () => {
  it.each([
    {event: 'delta', data: {turn_id: uuid, model_call_index: 0, text: 'Hel'}},
    {event: 'reset', data: {reason: 'retry'}},
    {event: 'reset', data: {reason: 'reconnect'}},
    {event: 'turn', data: {turn_id: uuid, status: 'failed', failure_code: 'step_limit'}},
  ])('accepts a $event event', (message) => {
    const parsed = conversationStreamEventSchema.parse(message);

    expect(parsed).toEqual(message);
  });

  it.each([
    {name: 'an unknown event', message: {event: 'ping', data: {}}},
    {name: 'a delta with no text', message: {event: 'delta', data: {turn_id: uuid}}},
    {name: 'a reset with an unknown reason', message: {event: 'reset', data: {reason: 'gap'}}},
    {
      name: 'a turn with an unknown status',
      message: {event: 'turn', data: {turn_id: uuid, status: 'paused', failure_code: null}},
    },
  ])('rejects $name', ({message}) => {
    const parse = () => conversationStreamEventSchema.parse(message);

    expect(parse).toThrow();
  });
});
