import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorkflowEnvironment} from '@shipfox/expression';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import {composeTemplate, type TemplateRoleBindings} from './composer.js';
import {loadShippedTemplates} from './loader.js';

type YamlRecord = Record<string, unknown>;

const template = loadShippedTemplates().find((entry) => entry.manifest.id === 'ticket-to-pr');
if (template === undefined) throw new Error('Missing ticket to PR template');
const manualOnly: TemplateRoleBindings = {source: 'github'};
const linear: TemplateRoleBindings = {tracker: 'linear', source: 'github'};
const defaults: Readonly<Record<string, string>> = Object.fromEntries(
  template.manifest.options.flatMap((option) => {
    const defaultChoice = option.choices.find((choice) => choice.default === true);
    return defaultChoice === undefined ? [] : [[option.id, defaultChoice.id]];
  }),
);
const optionMarker = /^\s*# option:([a-z_]+)=([a-z_]+) (begin|end)$/;
const expressionPattern = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/;
const heredocPattern = /^([a-z_]+)<<(\w+)$/;
const runNamePrefix = /^Implement /;
const environment = createWorkflowEnvironment();
const roots: string[] = [];

function render(bindings: TemplateRoleBindings, selections: Record<string, string> = {}): string {
  const chosen = {...defaults, ...selections};
  const selected: boolean[] = [];
  return composeTemplate(template as NonNullable<typeof template>, bindings)
    .split('\n')
    .filter((line) => {
      const marker = optionMarker.exec(line);
      if (marker === null) return selected.every(Boolean);
      if (marker[3] === 'begin') selected.push(chosen[marker[1] as string] === marker[2]);
      else selected.pop();
      return false;
    })
    .join('\n');
}

function workflow(bindings: TemplateRoleBindings, selections?: Record<string, string>): YamlRecord {
  const yaml = render(bindings, selections);
  parseWorkflowDocument(parseYaml(yaml));
  return parseYaml(yaml) as YamlRecord;
}

function at(value: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>((current, key) => (current as YamlRecord)[key], value);
}

function step(document: YamlRecord, job: string, key: string): YamlRecord {
  const steps = at(document, 'jobs', job, 'steps') as YamlRecord[];
  const found = steps.find((entry) => entry.key === key);
  if (found === undefined) throw new Error(`Missing step ${job}.${key}`);
  return found;
}

function toolSteps(document: YamlRecord): unknown[] {
  return Object.values(at(document, 'jobs') as YamlRecord).flatMap((job) =>
    ((job as YamlRecord).steps as YamlRecord[]).flatMap((entry) =>
      entry.tool === undefined ? [] : [entry.tool],
    ),
  );
}

function evaluate(source: unknown, context: YamlRecord): unknown {
  const expression = expressionPattern.exec(String(source))?.[1] ?? String(source);
  return environment.evaluate(expression, context);
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'shipfox-ticket-to-pr-'));
  roots.push(root);
  return root;
}

function runStep(entry: YamlRecord, context: YamlRecord, cwd = tempRoot()) {
  const env = Object.fromEntries(
    Object.entries((entry.env ?? {}) as YamlRecord).map(([name, value]) => [
      name,
      String(evaluate(value, context)),
    ]),
  );
  const output = join(cwd, '.shipfox-output');
  writeFileSync(output, '');
  const result = spawnSync('bash', ['-eo', 'pipefail', '-c', String(entry.run)], {
    cwd,
    encoding: 'utf8',
    env: {...process.env, ...env, SHIPFOX_OUTPUT: output},
  });
  return {status: result.status, stderr: result.stderr, outputs: readOutputs(output)};
}

function readOutputs(path: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  let heredoc: {name: string; delimiter: string; body: string[]} | undefined;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (heredoc !== undefined) {
      if (line === heredoc.delimiter) {
        outputs[heredoc.name] = heredoc.body.join('\n');
        heredoc = undefined;
      } else {
        heredoc.body.push(line);
      }
      continue;
    }
    const start = heredocPattern.exec(line);
    if (start !== null) {
      heredoc = {name: start[1] as string, delimiter: start[2] as string, body: []};
    } else if (line.includes('=')) {
      outputs[line.slice(0, line.indexOf('='))] = line.slice(line.indexOf('=') + 1);
    }
  }
  return outputs;
}

const manualInputs = {
  repository: 'Acme/API',
  title: 'Add a health check',
  description: 'Expose GET /health.',
  acceptance_criteria: '- GET /health returns 200\n- The route has a test',
  url: 'https://acme.slack.com/archives/C1/p1700000001000100',
  request: 'Please keep it small.',
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('ticket to PR template', () => {
  it('composes a manual-only worker with feedback enabled by default', () => {
    const document = workflow(manualOnly);

    expect(render(manualOnly).split('\n')[1]).toBe(
      '# shipfox-template: ticket-to-pr@5 source=github',
    );
    expect(Object.keys(at(document, 'triggers') as YamlRecord)).toEqual(['manual']);
    expect(Object.keys(at(document, 'jobs') as YamlRecord)).toEqual([
      'implement',
      'respond_to_feedback',
    ]);
    expect(step(document, 'implement', 'fix')).toMatchObject({
      model: 'gpt-6-luna',
      thinking: 'max',
    });
    expect(step(document, 'respond_to_feedback', 'respond')).toMatchObject({
      model: 'gpt-6-luna',
      thinking: 'max',
    });
    expect(step(document, 'respond_to_feedback', 'reply')).toMatchObject({
      model: 'glm-5.3-flash',
      thinking: 'low',
    });
    expect(
      Object.keys(at(workflow(manualOnly, {feedback_loop: 'off'}), 'jobs') as YamlRecord),
    ).toEqual(['implement']);
    expect(step(document, 'implement', 'fix').integrations).toBeUndefined();
    expect(toolSteps(document)).toEqual(['create_pull_request']);
  });

  it('keeps the manual trigger next to the Linear triggers and write-back', () => {
    const document = workflow(linear);

    expect(Object.keys(at(document, 'triggers') as YamlRecord)).toEqual([
      'manual',
      'on_agent_session',
    ]);
    expect(Object.keys(at(document, 'jobs') as YamlRecord)).toEqual([
      'implement',
      'comment_on_ticket_and_move_it',
      'respond_to_feedback',
    ]);
    expect(step(document, 'implement', 'mark_in_progress')).toMatchObject({
      if: `\${{ steps.task.outputs.ticket_id != "" }}`,
      tool: 'save_issue',
      with: {
        id: `\${{ steps.task.outputs.ticket_id }}`,
        state: 'In Progress',
      },
    });
    const implementSteps = at(document, 'jobs', 'implement', 'steps') as YamlRecord[];
    expect(implementSteps.findIndex((entry) => entry.key === 'mark_in_progress')).toBeLessThan(
      implementSteps.findIndex((entry) => entry.key === 'fix'),
    );
    expect(toolSteps(document)).toEqual([
      'save_issue',
      'save_comment',
      'create_pull_request',
      'save_comment',
    ]);
    expect(toolSteps(workflow(linear, {ticket_write_back: 'comment_and_transition'}))).toEqual([
      'save_issue',
      'save_comment',
      'create_pull_request',
      'save_comment',
    ]);
    expect(toolSteps(workflow(linear, {ticket_write_back: 'comment'}))).toEqual([
      'save_comment',
      'create_pull_request',
      'save_comment',
    ]);
    expect(toolSteps(workflow(linear, {ticket_write_back: 'none'}))).toEqual([
      'create_pull_request',
    ]);
  });

  it('publishes the task outcome for the workflow that started the run', () => {
    expect(Object.keys(at(workflow(manualOnly), 'outputs') as YamlRecord)).toEqual([
      'status',
      'identifier',
      'questions',
      'pr_number',
      'pr_url',
      'branch',
    ]);
  });

  it('reads a manual task and links the PR to its source', () => {
    const task = step(workflow(manualOnly), 'implement', 'task');

    const result = runStep(task, {
      trigger: {source: 'manual'},
      run: {number: 7},
      inputs: manualInputs,
    });

    expect(result.status).toBe(0);
    expect(result.outputs).toEqual({
      ticket_id: '',
      identifier: 'task-7',
      title: 'Add a health check',
      url: manualInputs.url,
      repository: 'Acme/API',
      reference: `Requested in ${manualInputs.url}`,
      description: 'Expose GET /health.',
      acceptance_criteria: manualInputs.acceptance_criteria,
      request: 'Please keep it small.',
    });
  });

  it('keeps the ticket identity a ticket loader passes', () => {
    const task = step(workflow(linear), 'implement', 'task');
    const inputs = {...manualInputs, ticket_id: 'issue-uuid', identifier: 'ENG-12'};

    const result = runStep(task, {trigger: {source: 'manual'}, run: {number: 7}, inputs});

    expect(result.outputs).toMatchObject({
      ticket_id: 'issue-uuid',
      identifier: 'ENG-12',
      reference: 'Fixes ENG-12',
    });
  });

  it('fails before the agent starts when a manual task misses required inputs', () => {
    const task = step(workflow(manualOnly), 'implement', 'task');
    const inputs = {title: 'Add a health check', description: 'Expose GET /health.'};

    const result = runStep(task, {trigger: {source: 'manual'}, run: {number: 7}, inputs});

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'A manual start needs these inputs: repository acceptance_criteria',
    );
  });

  it.each([
    {
      name: 'an agent session',
      event: {
        agentSession: {
          issue: {
            id: 'issue-uuid',
            identifier: 'ENG-12',
            title: 'Add a health check',
            url: 'https://linear.app/acme/issue/ENG-12',
            description: null,
          },
          comment: {body: 'Please keep it small.'},
        },
      },
      request: 'Please keep it small.',
    },
    {
      name: 'a labeled issue',
      event: {
        data: {
          id: 'issue-uuid',
          identifier: 'ENG-12',
          title: 'Add a health check',
          url: 'https://linear.app/acme/issue/ENG-12',
        },
      },
      request: '',
    },
  ])('reads the Linear ticket from $name', ({event, request}) => {
    const task = step(workflow(linear), 'implement', 'task');

    const result = runStep(task, {
      trigger: {source: 'linear_tracker'},
      run: {number: 7},
      event,
      inputs: {},
    });

    expect(result.outputs).toEqual({
      ticket_id: 'issue-uuid',
      identifier: 'ENG-12',
      title: 'Add a health check',
      url: 'https://linear.app/acme/issue/ENG-12',
      repository: '',
      reference: 'Fixes ENG-12',
      description: '',
      acceptance_criteria: '',
      request,
    });
  });

  it.each([
    {inputs: {identifier: 'ENG-12', title: 'Add a health check'}, name: 'ENG-12'},
    {inputs: {title: 'Add a health check'}, name: 'Add a health check'},
  ])('names a manual run $name', ({inputs, name}) => {
    const runName = String(at(workflow(linear), 'run_name'));

    expect(
      evaluate(runName.replace(runNamePrefix, ''), {trigger: {source: 'manual'}, inputs}),
    ).toBe(name);
  });

  it('asks the ticket for clarification only when the task has a ticket', () => {
    const ask = step(workflow(linear), 'implement', 'ask_questions');
    const context = (ticketId: string) => ({
      steps: {
        fix: {outputs: {status: 'needs_clarification'}},
        task: {outputs: {ticket_id: ticketId}},
      },
    });

    expect(evaluate(ask.if, context('issue-uuid'))).toBe(true);
    expect(evaluate(ask.if, context(''))).toBe(false);
  });

  it('refuses a task for another repository before touching the remote', () => {
    const root = tempRoot();
    const git = (...args: string[]) => execFileSync('git', args, {cwd: root, encoding: 'utf8'});
    git('init', '--quiet');
    git('remote', 'add', 'origin', 'https://github.com/acme/api.git');
    const prepare = step(workflow(manualOnly), 'implement', 'prepare');

    const result = runStep(
      prepare,
      {
        steps: {task: {outputs: {identifier: 'task-7', repository: 'acme/web'}}},
        run: {number: 7, attempt: 1},
      },
      root,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'The task names acme/web, but this project checks out acme/api.',
    );
  });
});
