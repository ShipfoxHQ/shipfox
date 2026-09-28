import {
  presentedActionInputs,
  readActionRuntime,
  readActionStepConfig,
  shortActionDigest,
} from './action-step.js';

const digest = `sha256:${'a1b2c3d4e5f6'.repeat(5)}abcd`;

describe('readActionStepConfig', () => {
  test('reads the action, inputs, bindings, and granted tools', () => {
    const config = readActionStepConfig({
      action: {uses: './.shipfox/actions/slack-thread', digest, main: 'index.ts', name: 'Thread'},
      inputs: {channel_id: 'C1'},
      integrations: [
        {
          alias: 'slack',
          provider: 'slack',
          connection_slug: 'team-slack',
          tools: [
            {id: 'read_thread', sensitivity: 'read', result: 'json'},
            {id: 'post_message', sensitivity: 'write'},
            {id: 'broken'},
          ],
        },
        {alias: 'missing-provider', connection_slug: 'x'},
      ],
    });

    expect(config).toEqual({
      name: 'Thread',
      uses: './.shipfox/actions/slack-thread',
      digest,
      inputs: {channel_id: 'C1'},
      secretInputs: new Map(),
      bindings: [
        {
          alias: 'slack',
          provider: 'slack',
          connectionSlug: 'team-slack',
          connectionId: null,
          tools: [
            {id: 'read_thread', sensitivity: 'read', result: 'json'},
            {id: 'post_message', sensitivity: 'write', result: 'json'},
          ],
        },
      ],
    });
  });

  test('returns null for a config without an action', () => {
    expect(readActionStepConfig({run: 'echo hi'})).toBeNull();
    expect(readActionStepConfig(null)).toBeNull();
  });
});

test('masks secret-bound inputs with their reference', () => {
  const config = readActionStepConfig({
    action: {uses: './action'},
    inputs: {registry: 'npm'},
    secret_bindings: [
      {target: {kind: 'input', name: 'token'}, segments: [{kind: 'secret', key: 'NPM_TOKEN'}]},
      {target: 'ENV_ONLY', segments: [{kind: 'secret', key: 'OTHER'}]},
    ],
  });
  if (!config) throw new Error('Expected an action config.');

  expect(presentedActionInputs(config)).toEqual({
    registry: 'npm',
    token: '*** (secrets.NPM_TOKEN)',
  });
});

test('shortens a digest and keeps its algorithm', () => {
  expect(shortActionDigest(digest)).toBe('sha256:a1b2c3d4e5f6');
});

describe('readActionRuntime', () => {
  test('reads node and SDK versions from the first output line', () => {
    expect(
      readActionRuntime([
        {type: 'marker'},
        {
          type: 'output',
          data: `Shipfox action Slack thread ${digest} · node v24.3.0 · @shipfox/actions 0.4.1\nnext`,
        },
      ]),
    ).toEqual({node: 'v24.3.0', sdk: '0.4.1'});
  });

  test('returns null when the first line is not the action banner', () => {
    expect(readActionRuntime([{type: 'output', data: 'hello'}])).toBeNull();
    expect(readActionRuntime([])).toBeNull();
  });
});
