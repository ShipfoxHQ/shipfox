import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkflowEnvironment} from '@shipfox/expression';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import {composeTemplate} from './composer.js';
import {loadShippedTemplates} from './loader.js';

type EntryPoint = 'mention' | 'dispatch_only';
type YamlRecord = Record<string, unknown>;

const template = loadShippedTemplates().find((entry) => entry.manifest.id === 'ask-codebase');
if (template === undefined) throw new Error('Missing codebase question template');
const composed = composeTemplate(template, {chat: 'slack', source: 'github'});
const entryPointMarker = /^\s*# option:entry_point=(\w+) (begin|end)$/;
const expressionPattern = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/;
const environment = createWorkflowEnvironment();
const roots: string[] = [];

function render(entryPoint: EntryPoint): string {
  let selected = true;
  return composed
    .split('\n')
    .filter((line) => {
      const marker = entryPointMarker.exec(line);
      if (marker !== null) {
        selected = marker[2] === 'end' || marker[1] === entryPoint;
        return false;
      }
      return selected;
    })
    .join('\n');
}

function workflow(entryPoint: EntryPoint = 'mention'): YamlRecord {
  const yaml = render(entryPoint);
  parseWorkflowDocument(parseYaml(yaml));
  return parseYaml(yaml) as YamlRecord;
}

function at(value: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>((current, key) => (current as YamlRecord)[key], value);
}

function step(job: string, key: string): YamlRecord {
  const steps = at(workflow(), 'jobs', job, 'steps') as YamlRecord[];
  const found = steps.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`Missing step ${job}.${key}`);
  return found;
}

function evaluate(source: unknown, context: YamlRecord): unknown {
  const expression = expressionPattern.exec(String(source))?.[1] ?? String(source);
  return environment.evaluate(expression, context);
}

const mentionFilter = at(workflow(), 'triggers', 'on_mention', 'filter');
const threadOutputs = at(workflow(), 'jobs', 'thread', 'outputs') as YamlRecord;

function thread(context: YamlRecord) {
  return {
    channelId: evaluate(threadOutputs.channel_id, context),
    threadTs: evaluate(threadOutputs.thread_ts, context),
    request: evaluate(threadOutputs.request, context),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('codebase question template', () => {
  it('keeps a manual entry point and adds the mention trigger only when selected', () => {
    expect(Object.keys(at(workflow('mention'), 'triggers') as YamlRecord)).toEqual([
      'manual',
      'on_mention',
    ]);
    expect(Object.keys(at(workflow('dispatch_only'), 'triggers') as YamlRecord)).toEqual([
      'manual',
    ]);
  });

  it('answers from a read-only checkout without saved credentials or agent tools', () => {
    expect(at(workflow(), 'jobs', 'answer', 'checkout')).toEqual({
      permissions: {contents: 'read'},
      'persist-credentials': false,
    });
    expect(step('answer', 'answer').integrations).toBeUndefined();

    const toolSteps = Object.values(at(workflow(), 'jobs') as YamlRecord).flatMap((job) =>
      ((job as YamlRecord).steps as YamlRecord[]).flatMap((entry) =>
        entry.tool === undefined ? [] : [entry.tool],
      ),
    );
    expect(toolSteps).toEqual(['read_thread', 'send_message', 'send_message']);
  });

  it.each([
    {name: 'a person in an allowed channel', event: {channel: 'C_ALLOWED'}, expected: true},
    {name: 'a person in another channel', event: {channel: 'C_OTHER'}, expected: false},
    {name: 'a bot', event: {channel: 'C_ALLOWED', bot_id: 'B123'}, expected: false},
  ])('starts for a mention from $name: $expected', ({event, expected}) => {
    const filter = String(mentionFilter).replace('replace-with-channel-id', 'C_ALLOWED');

    expect(evaluate(filter, {event: {type: 'app_mention', ...event}})).toBe(expected);
  });

  it('replies in the existing thread of a threaded mention', () => {
    const event = {
      channel: 'C1',
      ts: '1700000002.000200',
      thread_ts: '1700000001.000100',
      text: '<@U1> and the follow-up?',
    };

    expect(thread({trigger: {source: 'slack_chat'}, event, inputs: null})).toEqual({
      channelId: 'C1',
      threadTs: '1700000001.000100',
      request: '<@U1> and the follow-up?',
    });
  });

  it('starts a thread under a top-level mention and passes its text', () => {
    const event = {channel: 'C1', ts: '1700000002.000200', text: '<@U1> where is auth?'};

    expect(thread({trigger: {source: 'slack_chat'}, event, inputs: null})).toEqual({
      channelId: 'C1',
      threadTs: '1700000002.000200',
      request: '<@U1> where is auth?',
    });
  });

  it.each([
    {
      inputs: {channel_id: 'C2', thread_ts: '1.2', request: 'Where is auth?'},
      request: 'Where is auth?',
    },
    {inputs: {channel_id: 'C2', thread_ts: '1.2'}, request: ''},
  ])('reads the thread and request from manual inputs', ({inputs, request}) => {
    expect(thread({trigger: {source: 'manual'}, event: null, inputs})).toEqual({
      channelId: 'C2',
      threadTs: '1.2',
      request,
    });
  });

  it('fails before reading a thread when manual inputs are missing', () => {
    expect(() => thread({trigger: {source: 'manual'}, event: null, inputs: {}})).toThrow();
  });

  it('passes the agent the author, time, and bounded text of each thread message', () => {
    const outputs = step('thread', 'read_thread').outputs as YamlRecord;
    const result = {
      has_more: true,
      messages: [
        {ts: '1.1', user: 'U1', text: 'Where is auth?', blocks: [{type: 'rich_text'}]},
        {ts: '1.2', bot_id: 'B1', user: 'U9', text: 'Automated note'},
        {ts: '1.3', user: 'U2'},
        {ts: '1.4', user: 'U3', text: 'x'.repeat(1001)},
      ],
    };

    expect(JSON.parse(String(evaluate(outputs.messages, {result})))).toEqual([
      {ts: '1.1', author: 'U1', text: 'Where is auth?'},
      {ts: '1.2', author: 'bot:B1', text: 'Automated note'},
      {ts: '1.3', author: 'U2', text: ''},
      {ts: '1.4', author: 'U3', text: `${'x'.repeat(1000)} [truncated]`},
    ]);
    expect(evaluate(outputs.truncated, {result})).toBe(true);
    expect(evaluate(outputs.truncated, {result: {messages: []}})).toBe(false);
  });

  it.each([
    'https://x-access-token:secret-token@github.com/acme/api.git',
    'git@github.com:acme/api.git',
    'https://github.com/acme/api',
  ])('reports the repository from %s without credentials', (remote) => {
    const root = mkdtempSync(join(tmpdir(), 'shipfox-ask-codebase-'));
    roots.push(root);
    const git = (...args: string[]) => execFileSync('git', args, {cwd: root, encoding: 'utf8'});
    git('init', '--quiet');
    git('config', 'user.email', 'template-test@example.com');
    git('config', 'user.name', 'Template Test');
    git('config', 'commit.gpgsign', 'false');
    git('commit', '--allow-empty', '-qm', 'Initial commit');
    git('remote', 'add', 'origin', remote);
    const output = join(root, 'outputs');
    writeFileSync(output, '');

    const result = spawnSync(
      'bash',
      ['-eo', 'pipefail', '-c', String(step('answer', 'revision').run)],
      {
        cwd: root,
        encoding: 'utf8',
        env: {...process.env, SHIPFOX_OUTPUT: output},
      },
    );

    expect(result.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe(
      `repository=acme/api\ncommit=${git('rev-parse', '--short=12', 'HEAD').trim()}\n`,
    );
  });
});
