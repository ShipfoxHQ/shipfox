import {pairSessionRows, resolveActionPresentation} from './activity.js';
import type {SessionViewRow} from './log-model.js';
import {shipfoxActionPresentation} from './shipfox-tools.js';

const REJECTION =
  'Output "count" must be a number\n\nRetry set_output using this exact contract:\n\n- key';

function action(
  name: string,
  input: unknown,
  output = 'Output "channel_id" set.',
  isError = false,
) {
  const rows: {seq: number; lineNumber: number; row: SessionViewRow}[] = [
    {
      seq: 1,
      lineNumber: 1,
      row: {kind: 'tool-call', timestamp: 10, id: 'call', name, input: JSON.stringify(input)},
    },
    {
      seq: 2,
      lineNumber: 2,
      row: {
        kind: 'tool-result',
        timestamp: 20,
        toolCallId: 'call',
        toolName: name,
        output,
        isError,
      },
    },
  ];
  const [item] = pairSessionRows(rows);
  if (item?.kind !== 'action') throw new Error('expected paired action');
  return item.action;
}

describe('shipfoxActionPresentation', () => {
  test.each([
    'set_output',
    'mcp__shipfox_outputs__set_output',
  ])('%s shows the output key and value as a write', (name) => {
    const presentation = shipfoxActionPresentation(
      action(name, {key: 'channel_id', value: 'C0BKY1J7C79'}),
    );

    expect(presentation).toMatchObject({
      label: 'Set Output',
      target: 'channel_id',
      iconKind: 'output',
      readClassification: 'write',
      statusDetail: undefined,
      detail: {label: 'Value', value: 'C0BKY1J7C79', kind: 'code'},
    });
  });

  test('marks a Pi rejection as failed even without an error flag', () => {
    const rejected = action('set_output', {key: 'count', value: 'many'}, REJECTION);

    expect(rejected.state).toBe('failed');
    expect(shipfoxActionPresentation(rejected)?.statusDetail).toBe('rejected');
  });

  test('keeps a Claude rejection failed through the error flag', () => {
    const rejected = action(
      'mcp__shipfox_outputs__set_output',
      {key: 'count', value: 'many'},
      REJECTION,
      true,
    );

    expect(rejected.state).toBe('failed');
  });

  test('falls back when the input lacks a key or the name is not a Shipfox tool', () => {
    expect(shipfoxActionPresentation(action('set_output', {value: 'x'}))).toBeUndefined();
    expect(
      shipfoxActionPresentation(action('set_outputs', {key: 'k', value: 'x'})),
    ).toBeUndefined();
    expect(resolveActionPresentation(action('set_output', {value: 'x'}))).toMatchObject({
      label: 'Set Output',
      iconKind: 'tool',
    });
  });
});
