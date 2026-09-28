import {spawnSync} from 'node:child_process';
import {createWorkflowEnvironment} from '@shipfox/expression';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import {composeTemplate} from './composer.js';
import {loadShippedTemplates} from './loader.js';

type YamlRecord = Record<string, unknown>;

const template = loadShippedTemplates().find((entry) => entry.id === 'slack-dispatcher');
if (template === undefined) throw new Error('Missing Slack dispatcher template');
const composed = composeTemplate(template, {chat: 'slack'});
parseWorkflowDocument(parseYaml(composed));
const workflow = parseYaml(composed) as YamlRecord;
const expressionPattern = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/;
const environment = createWorkflowEnvironment();
const childRunId = '0199a8f0-0000-7000-8000-000000000001';

function at(value: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>((current, key) => (current as YamlRecord)[key], value);
}

function step(job: string, key: string): YamlRecord {
  const steps = at(workflow, 'jobs', job, 'steps') as YamlRecord[];
  const found = steps.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`Missing step ${job}.${key}`);
  return found;
}

function evaluate(source: unknown, context: YamlRecord): unknown {
  const expression = expressionPattern.exec(String(source).trim())?.[1] ?? String(source);
  return environment.evaluate(expression, context);
}

function jobCompleted(job: YamlRecord, runId = childRunId): YamlRecord {
  return {event: 'job.completed', data: {run: {id: runId}, job}};
}

function runCompleted(status: string, runId = childRunId): YamlRecord {
  return {event: 'run.completed', data: {run: {id: runId, status, outputs: null}}};
}

describe('Slack dispatcher template', () => {
  it('starts only from Slack mentions, so no workflow can start it', () => {
    expect(Object.keys(at(workflow, 'triggers') as YamlRecord)).toEqual(['on_mention']);
    expect(template.startsManually).toBe(false);
  });

  it.each([
    {name: 'a person in an allowed channel', event: {channel: 'C_ALLOWED'}, expected: true},
    {name: 'a person in another channel', event: {channel: 'C_OTHER'}, expected: false},
    {name: 'a bot', event: {channel: 'C_ALLOWED', bot_id: 'B123'}, expected: false},
  ])('routes a mention from $name: $expected', ({event, expected}) => {
    const filter = String(at(workflow, 'triggers', 'on_mention', 'filter')).replace(
      'replace-with-channel-id',
      'C_ALLOWED',
    );

    expect(evaluate(filter, {event: {type: 'app_mention', ...event}})).toBe(expected);
  });

  it.each([
    {name: 'a threaded mention', event: {ts: '2.2', thread_ts: '1.1'}, expected: '1.1'},
    {name: 'a top-level mention', event: {ts: '2.2'}, expected: '2.2'},
  ])('replies in the thread of $name', ({event, expected}) => {
    const threadTs = at(workflow, 'jobs', 'thread', 'outputs', 'thread_ts');

    expect(evaluate(threadTs, {event: {channel: 'C1', text: 'hi', ...event}})).toBe(expected);
  });

  it('gives the routing agent no tools and no checkout', () => {
    for (const job of Object.values(at(workflow, 'jobs') as YamlRecord)) {
      expect((job as YamlRecord).checkout).toBe(false);
    }
    expect(step('route', 'route')).not.toHaveProperty('integrations');
  });

  it('writes only Slack thread replies and one workflow start', () => {
    const tools = Object.values(at(workflow, 'jobs') as YamlRecord).flatMap((job) =>
      ((job as YamlRecord).steps as YamlRecord[]).flatMap((entry) =>
        entry.tool === undefined ? [] : [String(entry.tool)],
      ),
    );

    expect(tools).toEqual([
      'read_thread',
      'get_permalink',
      'send_message',
      'start_workflow_run',
      'send_message',
      'send_message',
      'send_message',
      'send_message',
      'send_message',
    ]);
  });

  it('starts only a workflow that the prompt lists, in this project', () => {
    const prompt = String(step('route', 'route').prompt);
    const listed = [...prompt.matchAll(/^\d+\. `([^`]+)`$/gm)].map((match) => match[1]);
    const allowed = at(step('route', 'route'), 'outputs', 'workflow', 'schema', 'enum');

    expect(listed).toEqual([
      '.shipfox/workflows/ask-codebase.yml',
      '.shipfox/workflows/slack-to-ticket.yml',
      '.shipfox/workflows/ticket-to-pr.yml',
    ]);
    expect(allowed).toEqual(['', ...listed]);
    const start = step('route', 'start').with as YamlRecord;
    expect(Object.keys(start)).toEqual(['workflow', 'inputs']);
    expect(evaluate(start.workflow, {steps: {route: {outputs: {workflow: listed[0]}}}})).toBe(
      listed[0],
    );
  });

  it.each([
    {status: 'start', reply: false, start: true, followUp: true},
    {status: 'needs_information', reply: true, start: false, followUp: false},
    {status: 'already_started', reply: true, start: false, followUp: false},
    {status: 'no_match', reply: true, start: false, followUp: false},
  ])('starts a workflow only for a $status route', ({status, reply, start, followUp}) => {
    const steps = {route: {outputs: {status}}};
    const execution = {failed: false};

    expect(evaluate(step('route', 'reply').if, {steps})).toBe(reply);
    expect(evaluate(step('route', 'check_thread').if, {steps})).toBe(start);
    expect(evaluate(step('route', 'start').if, {steps, execution})).toBe(start);
    expect(evaluate(step('route', 'started').if, {steps, execution})).toBe(start);
    expect(
      evaluate(at(workflow, 'jobs', 'follow_up', 'if'), {
        needs: [{status: 'succeeded'}],
        jobs: {route: {outputs: {status}}},
      }),
    ).toBe(followUp);
  });

  it.each(['start', 'started'])('skips %s after the thread check or the start fails', (key) => {
    const context = {steps: {route: {outputs: {status: 'start'}}}, execution: {failed: true}};

    expect(evaluate(step('route', key).if, context)).toBe(false);
  });

  it('asks the person to mention the app again after questions', () => {
    const message = at(step('route', 'reply'), 'with', 'message');

    expect(
      evaluate(message, {
        steps: {route: {outputs: {status: 'needs_information', reply: 'Which?'}}},
      }),
    ).toBe('Which?\n\n_Answer in this thread, then mention the app again._');
    expect(
      evaluate(message, {steps: {route: {outputs: {status: 'no_match', reply: 'I route code.'}}}}),
    ).toBe('I route code.');
  });

  it.each([
    {
      name: 'the same thread',
      inputs: {channel_id: 'C1', thread_ts: '1.1', request: 'Why?'},
      ok: true,
    },
    {name: 'no thread inputs', inputs: {repository: 'acme/api', title: 'Fix'}, ok: true},
    {name: 'another channel', inputs: {channel_id: 'C2', thread_ts: '1.1'}, ok: false},
    {name: 'another thread', inputs: {channel_id: 'C1', thread_ts: '9.9'}, ok: false},
  ])('checks that routed inputs name $name: $ok', ({inputs, ok}) => {
    const check = step('route', 'check_thread');
    const sameThread = evaluate((check.env as YamlRecord).SAME_THREAD, {
      steps: {route: {outputs: {inputs}}},
      jobs: {thread: {outputs: {channel_id: 'C1', thread_ts: '1.1'}}},
    });

    const result = spawnSync('bash', ['-eo', 'pipefail', '-c', String(check.run)], {
      encoding: 'utf8',
      env: {...process.env, SAME_THREAD: String(sameThread)},
    });

    expect(result.status === 0).toBe(ok);
  });

  it('follows only the started run and stops after one result', () => {
    const listening = at(workflow, 'jobs', 'follow_up', 'listening') as YamlRecord;
    const [jobMatcher, runMatcher] = listening.on as [YamlRecord, YamlRecord];
    const jobs = {route: {outputs: {run_id: childRunId}}};
    const otherRunId = '0199a8f0-0000-7000-8000-000000000002';

    expect(listening).toMatchObject({max_executions: 1, timeout: '12h'});
    expect(
      evaluate(jobMatcher.filter, {jobs, event: {run: {id: childRunId}, job: {key: 'implement'}}}),
    ).toBe(true);
    expect(
      evaluate(jobMatcher.filter, {jobs, event: {run: {id: childRunId}, job: {key: 'answer'}}}),
    ).toBe(false);
    expect(
      evaluate(jobMatcher.filter, {jobs, event: {run: {id: otherRunId}, job: {key: 'implement'}}}),
    ).toBe(false);
    expect(evaluate(runMatcher.filter, {jobs, event: {run: {id: childRunId}}})).toBe(true);
    expect(evaluate(runMatcher.filter, {jobs, event: {run: {id: otherRunId}}})).toBe(false);
  });

  it.each([
    {
      name: 'an opened pull request',
      events: [
        jobCompleted({
          key: 'implement',
          status: 'succeeded',
          outputs: {
            status: 'implemented',
            pr_url: 'https://github.com/acme/api/pull/7',
            questions: '',
          },
        }),
      ],
      posted: ['pull_request'],
    },
    {
      name: 'implementation questions',
      events: [
        jobCompleted({
          key: 'implement',
          status: 'succeeded',
          outputs: {status: 'needs_clarification', pr_url: '', questions: 'Which endpoint?'},
        }),
        runCompleted('succeeded'),
      ],
      posted: ['questions'],
    },
    {
      name: 'a failed implementation',
      events: [
        jobCompleted({key: 'implement', status: 'failed', outputs: null}),
        runCompleted('failed'),
      ],
      posted: ['stopped'],
    },
    {name: 'a workflow that replies itself', events: [runCompleted('succeeded')], posted: []},
    {name: 'a failed workflow that replies itself', events: [runCompleted('failed')], posted: []},
  ])('reports $name in the thread', ({events, posted}) => {
    const steps = at(workflow, 'jobs', 'follow_up', 'steps') as YamlRecord[];

    expect(
      steps
        .filter((entry) => evaluate(entry.if, {execution: {events}}) === true)
        .map((entry) => entry.key),
    ).toEqual(posted);
  });

  it('links the pull request and the run that opened it', () => {
    const message = String(at(step('follow_up', 'pull_request'), 'with', 'message'));
    const context = {
      jobs: {route: {outputs: {run_id: childRunId, run_number: 12}}},
      execution: {
        events: [
          jobCompleted({
            key: 'implement',
            status: 'succeeded',
            outputs: {pr_url: 'https://github.com/acme/api/pull/7'},
          }),
        ],
      },
    };
    const rendered = message.replace(/\$\{\{\s*([\s\S]*?)\s*\}\}/g, (_match, expression) =>
      String(environment.evaluate(expression, context)),
    );

    expect(rendered).toBe(
      [
        `Run [#12](https://app.shipfox.io/runs/${childRunId}) opened a pull request for this request: https://github.com/acme/api/pull/7`,
        '',
        '_Review it before you merge it._',
      ].join('\n'),
    );
  });
});
