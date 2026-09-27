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

type YamlRecord = Record<string, unknown>;

const template = loadShippedTemplates().find((entry) => entry.manifest.id === 'slack-to-ticket');
if (template === undefined) throw new Error('Missing Slack ticket template');
const composed = composeTemplate(template, {chat: 'slack', tracker: 'linear', source: 'github'});
const optionMarker = /^\s*# option:(\w+)=(\w+) (begin|end)$/;
const expressionPattern = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/;
const environment = createWorkflowEnvironment();
const defaults = {entry_point: 'mention', ticket_project: 'team_only'};
const roots: string[] = [];

type Selections = typeof defaults;

function workflow(selections: Partial<Selections> = {}): YamlRecord {
  const selected = {...defaults, ...selections};
  const open: boolean[] = [];
  const yaml = composed
    .split('\n')
    .filter((line) => {
      const marker = optionMarker.exec(line);
      if (marker === null) return open.every(Boolean);
      if (marker[3] === 'begin') {
        open.push(selected[marker[1] as keyof Selections] === marker[2]);
      } else {
        open.pop();
      }
      return false;
    })
    .join('\n');
  parseWorkflowDocument(parseYaml(yaml));
  return parseYaml(yaml) as YamlRecord;
}

function at(value: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>((current, key) => (current as YamlRecord)[key], value);
}

function step(job: string, key: string, selections: Partial<Selections> = {}): YamlRecord {
  const steps = at(workflow(selections), 'jobs', job, 'steps') as YamlRecord[];
  const found = steps.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`Missing step ${job}.${key}`);
  return found;
}

function evaluate(source: unknown, context: YamlRecord): unknown {
  const expression = expressionPattern.exec(String(source))?.[1] ?? String(source);
  return environment.evaluate(expression, context);
}

function toolSteps(document: YamlRecord): string[] {
  return Object.values(at(document, 'jobs') as YamlRecord).flatMap((job) =>
    ((job as YamlRecord).steps as YamlRecord[]).flatMap((entry) =>
      entry.tool === undefined ? [] : [String(entry.tool)],
    ),
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('Slack ticket template', () => {
  it('keeps a manual entry point and adds the mention trigger only when selected', () => {
    expect(Object.keys(at(workflow(), 'triggers') as YamlRecord)).toEqual(['manual', 'on_mention']);
    expect(
      Object.keys(at(workflow({entry_point: 'dispatch_only'}), 'triggers') as YamlRecord),
    ).toEqual(['manual']);
  });

  it.each([
    {name: 'a person in an allowed channel', event: {channel: 'C_ALLOWED'}, expected: true},
    {name: 'a person in another channel', event: {channel: 'C_OTHER'}, expected: false},
    {name: 'a bot', event: {channel: 'C_ALLOWED', bot_id: 'B123'}, expected: false},
  ])('starts for a mention from $name: $expected', ({event, expected}) => {
    const filter = String(at(workflow(), 'triggers', 'on_mention', 'filter')).replace(
      'replace-with-channel-id',
      'C_ALLOWED',
    );

    expect(evaluate(filter, {event: {type: 'app_mention', ...event}})).toBe(expected);
  });

  it('drafts from a read-only checkout with read-only Slack thread access', () => {
    expect(at(workflow(), 'jobs', 'draft', 'checkout')).toEqual({
      permissions: {contents: 'read'},
      'persist-credentials': false,
    });
    expect(step('draft', 'draft').integrations).toEqual([
      {connection: 'slack_chat', include: ['read_thread']},
    ]);
  });

  it('limits writes to one Linear ticket and Slack thread replies', () => {
    expect(toolSteps(workflow())).toEqual([
      'get_permalink',
      'send_message',
      'send_message',
      'save_issue',
      'send_message',
      'send_message',
    ]);
  });

  it('adds new tickets to a project only when that option is selected', () => {
    expect(step('ticket', 'create_ticket').with).toMatchObject({team: 'replace-with-team-key'});
    expect(step('ticket', 'create_ticket').with).not.toHaveProperty('project');
    expect(step('ticket', 'create_ticket', {ticket_project: 'project'}).with).toMatchObject({
      team: 'replace-with-team-key',
      project: 'replace-with-project',
    });
  });

  it.each([
    {status: 'ready', ticket: true, ask: false, tracked: false},
    {status: 'needs_information', ticket: false, ask: true, tracked: false},
    {status: 'already_tracked', ticket: false, ask: false, tracked: true},
  ])('writes only what a $status draft needs', ({status, ticket, ask, tracked}) => {
    const condition = at(workflow(), 'jobs', 'ticket', 'if');
    const steps = {draft: {outputs: {status}}};

    expect(
      evaluate(condition, {
        needs: [{status: 'succeeded'}, {status: 'succeeded'}],
        jobs: {draft: {outputs: {status}}},
      }),
    ).toBe(ticket);
    expect(evaluate(step('draft', 'ask').if, {steps})).toBe(ask);
    expect(evaluate(step('draft', 'already_tracked').if, {steps})).toBe(tracked);
  });

  it('reads the created ticket identifier and URL from the Linear result', () => {
    const outputs = step('ticket', 'create_ticket').outputs as YamlRecord;
    const result = {id: 'ENG-12', uuid: 'a6375416', url: 'https://linear.app/acme/issue/ENG-12'};

    expect(evaluate(outputs.identifier, {result})).toBe('ENG-12');
    expect(evaluate(outputs.url, {result})).toBe('https://linear.app/acme/issue/ENG-12');
  });

  it.each([
    'https://x-access-token:secret-token@github.com/acme/api.git',
    'git@github.com:acme/api.git',
    'https://github.com/acme/api',
  ])('builds code links from %s without credentials', (remote) => {
    const root = mkdtempSync(join(tmpdir(), 'shipfox-slack-to-ticket-'));
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
      ['-eo', 'pipefail', '-c', String(step('draft', 'revision').run)],
      {cwd: root, encoding: 'utf8', env: {...process.env, SHIPFOX_OUTPUT: output}},
    );

    const sha = git('rev-parse', 'HEAD').trim();
    expect(result.status).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe(
      [
        'repository=acme/api',
        `commit=${sha.slice(0, 12)}`,
        `code_url=https://github.com/acme/api/blob/${sha}`,
        `tree_url=https://github.com/acme/api/tree/${sha}`,
        '',
      ].join('\n'),
    );
  });
});
