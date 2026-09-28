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
const jira: TemplateRoleBindings = {tracker: 'jira', source: 'github'};
const clickup: TemplateRoleBindings = {tracker: 'clickup', source: 'github'};
const githubIssues: TemplateRoleBindings = {tracker: 'github', source: 'github'};
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

function trigger(document: YamlRecord, key: string): YamlRecord {
  return at(document, 'triggers', key) as YamlRecord;
}

function jiraWorkflow(selections: Record<string, string> = {}): YamlRecord {
  const yaml = render(jira, selections)
    .replaceAll('replace-with-project-key', 'ENG')
    .replaceAll('replace-with-label-name', 'shipfox')
    .replaceAll('replace-with-start-status', 'Ready for dev');
  parseWorkflowDocument(parseYaml(yaml));
  return parseYaml(yaml) as YamlRecord;
}

function jiraEvent({
  project = 'ENG',
  labels = [] as string[],
  status = 'To Do',
  changes = [] as YamlRecord[],
} = {}): YamlRecord {
  return {
    issue: {
      id: '10042',
      key: `${project}-12`,
      self: 'https://acme.atlassian.net/rest/api/2/issue/10042',
      fields: {
        summary: 'Add a health check',
        description: 'Expose GET /health.',
        labels,
        status: {id: '3', name: status},
        project: {key: project},
      },
    },
    changelog: {items: changes},
    cloudId: 'cloud-id',
  };
}

function clickupWorkflow(selections: Record<string, string> = {}): YamlRecord {
  const yaml = render(clickup, selections)
    .replaceAll('replace-with-list-id', 'list-1')
    .replaceAll('replace-with-tag-name', 'shipfox')
    .replaceAll('replace-with-trigger-status', 'ready for dev');
  parseWorkflowDocument(parseYaml(yaml));
  return parseYaml(yaml) as YamlRecord;
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
      expressionPattern.test(String(value)) ? String(evaluate(value, context)) : String(value),
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
      '# shipfox-template: ticket-to-pr@7 source=github',
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
      'comment_on_ticket',
      'respond_to_feedback',
    ]);
    expect(step(document, 'implement', 'mark_in_progress')).toMatchObject({
      if: `\${{ steps.task.outputs.ticket_id != "" }}`,
      tool: 'save_issue',
      with: {
        id: `\${{ steps.task.outputs.ticket_id }}`,
        state: 'started',
      },
      gate: {
        on_failure: {
          restart_from: 'task',
        },
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

  it('keeps the manual trigger next to the Jira triggers and write-back', () => {
    const document = workflow(jira);

    expect(render(jira).split('\n')[1]).toBe(
      '# shipfox-template: ticket-to-pr@7 tracker=jira source=github',
    );
    expect(Object.keys(at(document, 'triggers') as YamlRecord)).toEqual([
      'manual',
      'on_label_added',
      'on_labeled_issue_created',
    ]);
    expect(
      Object.keys(at(workflow(jira, {jira_trigger: 'status'}), 'triggers') as YamlRecord),
    ).toEqual(['manual', 'on_status_changed']);
    expect(step(document, 'implement', 'fix').integrations).toEqual([
      {connection: 'jira_tracker', include: ['get_issue', 'get_issue_comments']},
    ]);
    expect(Object.keys(at(document, 'jobs') as YamlRecord)).toEqual([
      'implement',
      'comment_on_ticket',
      'respond_to_feedback',
    ]);
    expect(toolSteps(document)).toEqual([
      'get_issue',
      'get_issue_transitions',
      'transition_issue',
      'add_comment',
      'create_pull_request',
      'add_comment',
    ]);
    expect(toolSteps(workflow(jira, {ticket_write_back: 'comment'}))).toEqual([
      'add_comment',
      'create_pull_request',
      'add_comment',
    ]);
    expect(toolSteps(workflow(jira, {ticket_write_back: 'none'}))).toEqual(['create_pull_request']);
  });

  it.each([
    {
      name: 'a label added to an issue',
      event: jiraEvent({
        labels: ['backend', 'shipfox'],
        changes: [
          {fieldId: 'labels', from: null, fromString: 'backend', toString: 'backend shipfox'},
        ],
      }),
      matches: true,
    },
    {
      name: 'the first label added to an issue',
      event: jiraEvent({
        labels: ['shipfox'],
        changes: [{fieldId: 'labels', from: null, fromString: '', toString: 'shipfox'}],
      }),
      matches: true,
    },
    {
      name: 'another label added next to the label',
      event: jiraEvent({
        labels: ['backend', 'shipfox'],
        changes: [
          {fieldId: 'labels', from: null, fromString: 'shipfox', toString: 'backend shipfox'},
        ],
      }),
      matches: false,
    },
    {
      name: 'a status change on a labeled issue',
      event: jiraEvent({
        labels: ['shipfox'],
        status: 'In Review',
        changes: [{fieldId: 'status', from: '3', fromString: 'To Do', toString: 'In Review'}],
      }),
      matches: false,
    },
    {
      name: 'a label added in another project',
      event: jiraEvent({
        project: 'OPS',
        labels: ['shipfox'],
        changes: [{fieldId: 'labels', from: null, fromString: '', toString: 'shipfox'}],
      }),
      matches: false,
    },
  ])('starts the Jira label trigger on $name: $matches', ({event, matches}) => {
    const filter = trigger(jiraWorkflow(), 'on_label_added').filter;

    expect(evaluate(filter, {event})).toBe(matches);
  });

  it('starts the Jira label trigger on an issue created with the label', () => {
    const filter = trigger(jiraWorkflow(), 'on_labeled_issue_created').filter;

    expect(evaluate(filter, {event: jiraEvent({labels: ['shipfox']})})).toBe(true);
    expect(evaluate(filter, {event: jiraEvent({labels: ['backend']})})).toBe(false);
  });

  it.each([
    {
      name: 'a move to the status',
      event: jiraEvent({
        status: 'Ready for dev',
        changes: [{fieldId: 'status', from: '1', fromString: 'To Do', toString: 'Ready for dev'}],
      }),
      matches: true,
    },
    {
      name: 'another change on an issue in the status',
      event: jiraEvent({
        status: 'Ready for dev',
        labels: ['backend'],
        changes: [{fieldId: 'labels', from: null, fromString: '', toString: 'backend'}],
      }),
      matches: false,
    },
    {
      name: 'a move to another status',
      event: jiraEvent({
        status: 'In Review',
        changes: [
          {fieldId: 'status', from: '3', fromString: 'Ready for dev', toString: 'In Review'},
        ],
      }),
      matches: false,
    },
  ])('starts the Jira status trigger on $name: $matches', ({event, matches}) => {
    const filter = trigger(jiraWorkflow({jira_trigger: 'status'}), 'on_status_changed').filter;

    expect(evaluate(filter, {event})).toBe(matches);
  });

  it.each([
    {description: 'Expose GET /health.', expected: 'Expose GET /health.'},
    {description: null, expected: ''},
  ])('reads the Jira ticket from an issue event with description $description', ({
    description,
    expected,
  }) => {
    const task = step(workflow(jira), 'implement', 'task');
    const event = jiraEvent({labels: ['shipfox']});
    (at(event, 'issue', 'fields') as YamlRecord).description = description;

    const result = runStep(task, {
      trigger: {source: 'jira_tracker'},
      run: {number: 7},
      event,
      inputs: {},
    });

    expect(result.status).toBe(0);
    expect(result.outputs).toEqual({
      ticket_id: '10042',
      identifier: 'ENG-12',
      title: 'Add a health check',
      url: 'https://acme.atlassian.net/browse/ENG-12',
      repository: '',
      reference: 'Fixes ENG-12',
      description: expected,
      acceptance_criteria: '',
      request: '',
    });
    expect(
      evaluate(String(at(workflow(jira), 'run_name')).replace(runNamePrefix, ''), {
        trigger: {source: 'jira_tracker'},
        event,
      }),
    ).toBe('ENG-12');
  });

  it('moves a Jira issue to an in-progress status only when it is still to do', () => {
    const document = jiraWorkflow();
    const read = step(document, 'implement', 'read_status');
    const find = step(document, 'implement', 'find_in_progress');
    const move = step(document, 'implement', 'mark_in_progress');
    const started = (key: string) =>
      evaluate((read.outputs as YamlRecord).started, {
        result: {fields: {status: {statusCategory: {key}}}},
      });
    const transitionId = (transitions: YamlRecord[]) =>
      evaluate((find.outputs as YamlRecord).transition_id, {result: {transitions}});
    const context = (isStarted: boolean, id: string) => ({
      steps: {
        task: {outputs: {ticket_id: '10042'}},
        read_status: {outputs: {started: isStarted}},
        find_in_progress: {outputs: {transition_id: id}},
      },
    });

    expect(started('new')).toBe(false);
    expect(started('indeterminate')).toBe(true);
    expect(started('done')).toBe(true);
    expect(
      transitionId([
        {id: '11', name: 'Close', to: {name: 'Done', statusCategory: {key: 'done'}}},
        {
          id: '21',
          name: 'Start',
          to: {name: 'In Progress', statusCategory: {key: 'indeterminate'}},
        },
      ]),
    ).toBe('21');
    expect(
      transitionId([{id: '11', name: 'Close', to: {name: 'Done', statusCategory: {key: 'done'}}}]),
    ).toBe('');
    expect(evaluate(move.if, context(false, '21'))).toBe(true);
    expect(evaluate(move.if, context(true, '21'))).toBe(false);
    expect(evaluate(move.if, context(false, ''))).toBe(false);
    expect(evaluate(find.if, context(true, ''))).toBe(false);
  });

  it('keeps the manual trigger next to the ClickUp triggers and write-back', () => {
    const document = workflow(clickup);

    expect(render(clickup).split('\n')[1]).toBe(
      '# shipfox-template: ticket-to-pr@7 tracker=clickup source=github',
    );
    expect(Object.keys(at(document, 'triggers') as YamlRecord)).toEqual(['manual', 'on_tag_added']);
    expect(
      Object.keys(at(workflow(clickup, {clickup_trigger: 'status'}), 'triggers') as YamlRecord),
    ).toEqual(['manual', 'on_status_changed']);
    expect(step(document, 'implement', 'fix').integrations).toEqual([
      {connection: 'clickup_tracker', include: ['get_task', 'get_task_comments']},
    ]);
    expect(Object.keys(at(document, 'jobs') as YamlRecord)).toEqual([
      'implement',
      'comment_on_ticket',
      'respond_to_feedback',
    ]);
    expect(toolSteps(document)).toEqual([
      'get_task',
      'update_task',
      'add_comment',
      'create_pull_request',
      'add_comment',
    ]);
    expect(toolSteps(workflow(clickup, {ticket_write_back: 'comment'}))).toEqual([
      'get_task',
      'add_comment',
      'create_pull_request',
      'add_comment',
    ]);
    expect(toolSteps(workflow(clickup, {ticket_write_back: 'none'}))).toEqual([
      'get_task',
      'create_pull_request',
    ]);
  });

  it.each([
    {name: 'the tag is added', field: 'tag', after: [{name: 'shipfox'}], matches: true},
    {name: 'another tag is added', field: 'tag', after: [{name: 'bug'}], matches: false},
    {name: 'the tag is removed', field: 'tag_removed', after: null, matches: false},
    {name: 'the tag list is emptied', field: 'tag', after: null, matches: false},
    {
      name: 'the tag is added in another List',
      field: 'tag',
      after: [{name: 'shipfox'}],
      list: 'other-list',
      matches: false,
    },
  ])('starts the ClickUp tag trigger when $name: $matches', ({field, after, list, matches}) => {
    const {event, filter} = trigger(clickupWorkflow(), 'on_tag_added');
    const payload = {
      task_id: '86abc',
      history_items: [{field, parent_id: list ?? 'list-1', after}],
    };

    expect(event).toBe('taskTagUpdated');
    expect(evaluate(filter, {event: payload})).toBe(matches);
  });

  it.each([
    {name: 'the task moves to the trigger status', status: 'ready for dev', matches: true},
    {name: 'the workflow moves the task on', status: 'in progress', matches: false},
  ])('starts the ClickUp status trigger when $name: $matches', ({status, matches}) => {
    const {event, filter} = trigger(
      clickupWorkflow({clickup_trigger: 'status'}),
      'on_status_changed',
    );
    const payload = {
      task_id: '86abc',
      history_items: [{field: 'status', parent_id: 'list-1', after: {status}}],
    };

    expect(event).toBe('taskStatusUpdated');
    expect(evaluate(filter, {event: payload})).toBe(matches);
  });

  it('reads the ClickUp task loaded from the event', () => {
    const task = step(workflow(clickup), 'implement', 'task');
    const loaded = {
      title: 'Add a health check',
      url: 'https://app.clickup.com/t/86abc',
      description: 'Expose GET /health.',
    };

    const result = runStep(task, {
      trigger: {source: 'clickup_tracker'},
      run: {number: 7},
      event: {task_id: '86abc'},
      steps: {load_ticket: {outputs: loaded}},
      inputs: {},
    });

    expect(result.outputs).toEqual({
      ticket_id: '86abc',
      identifier: 'CU-86abc',
      title: 'Add a health check',
      url: 'https://app.clickup.com/t/86abc',
      repository: '',
      reference: 'Fixes CU-86abc',
      description: 'Expose GET /health.',
      acceptance_criteria: '',
      request: '',
    });
  });

  it.each([
    {name: 'loads the ClickUp task from the event', source: 'clickup_tracker', taskId: '86abc'},
    {name: 'skips the ClickUp task load on a manual start', source: 'manual', taskId: ''},
  ])('$name', ({source, taskId}) => {
    const document = workflow(clickup);
    const reference = step(document, 'implement', 'ticket_ref');
    const load = step(document, 'implement', 'load_ticket');

    const result = runStep(reference, {trigger: {source}, event: {task_id: '86abc'}});

    expect(result.outputs).toEqual({task_id: taskId});
    expect(evaluate(load.if, {steps: {ticket_ref: {outputs: result.outputs}}})).toBe(taskId !== '');
  });

  it('moves a ClickUp task to the in-progress status before the fix', () => {
    const document = workflow(clickup);
    const steps = at(document, 'jobs', 'implement', 'steps') as YamlRecord[];

    expect(step(document, 'implement', 'mark_in_progress')).toMatchObject({
      tool: 'update_task',
      with: {
        task_id: `\${{ steps.task.outputs.ticket_id }}`,
        status: 'replace-with-in-progress-status',
      },
      gate: {on_failure: {restart_from: 'task'}},
    });
    expect(steps.findIndex((entry) => entry.key === 'mark_in_progress')).toBeLessThan(
      steps.findIndex((entry) => entry.key === 'fix'),
    );
  });

  it('keeps the manual trigger next to the GitHub issue triggers and write-back', () => {
    const document = workflow(githubIssues);

    expect(render(githubIssues).split('\n')[1]).toBe(
      '# shipfox-template: ticket-to-pr@7 tracker=github source=github',
    );
    expect(Object.keys(at(document, 'triggers') as YamlRecord)).toEqual([
      'manual',
      'on_issue_labeled',
    ]);
    expect(
      Object.keys(
        at(workflow(githubIssues, {github_trigger: 'assignee'}), 'triggers') as YamlRecord,
      ),
    ).toEqual(['manual', 'on_issue_assigned']);
    expect(step(document, 'implement', 'fix').integrations).toEqual([
      {connection: 'github_source', include: ['issue_read.get', 'issue_read.get_comments']},
    ]);
    expect(Object.keys(at(document, 'jobs') as YamlRecord)).toEqual([
      'implement',
      'comment_on_ticket',
      'respond_to_feedback',
    ]);
    expect(toolSteps(document)).toEqual([
      'issue_read.get',
      'issue_write.update',
      'add_issue_comment',
      'create_pull_request',
      'add_issue_comment',
    ]);
    expect(toolSteps(workflow(githubIssues, {ticket_write_back: 'none'}))).toEqual([
      'create_pull_request',
    ]);
    expect(render(githubIssues)).not.toContain('# bind:tracker');
  });

  it.each([
    {name: 'the trigger label is added', label: 'shipfox', state: 'open', matches: true},
    {
      name: 'the in-progress label is added',
      label: 'shipfox:in-progress',
      state: 'open',
      matches: false,
    },
    {name: 'a closed issue gets the label', label: 'shipfox', state: 'closed', matches: false},
    {
      name: 'the label is added in another repository',
      label: 'shipfox',
      state: 'open',
      repository: 'acme/web',
      matches: false,
    },
  ])('starts the GitHub label trigger when $name: $matches', ({
    label,
    state,
    repository,
    matches,
  }) => {
    const yaml = render(githubIssues)
      .replaceAll('replace-with-owner/repository', 'acme/api')
      .replaceAll('replace-with-label-name', 'shipfox');
    const {event, filter} = trigger(parseYaml(yaml) as YamlRecord, 'on_issue_labeled');
    const payload = {
      repository: {full_name: repository ?? 'acme/api'},
      issue: {number: 42n, state},
      label: {name: label},
    };

    expect(event).toBe('issues.labeled');
    expect(evaluate(filter, {event: payload})).toBe(matches);
  });

  it('reads the GitHub issue and references it so GitHub links the PR', () => {
    const task = step(workflow(githubIssues), 'implement', 'task');

    const result = runStep(task, {
      trigger: {source: 'github_source'},
      run: {number: 7},
      event: {
        issue: {
          number: 42n,
          title: 'Add a health check',
          html_url: 'https://github.com/acme/api/issues/42',
          body: null,
        },
      },
      inputs: {},
    });

    expect(result.outputs).toMatchObject({
      ticket_id: '42',
      identifier: 'issue-42',
      title: 'Add a health check',
      url: 'https://github.com/acme/api/issues/42',
      reference: 'Fixes #42',
      description: '',
    });
    expect(
      evaluate(String(at(workflow(githubIssues), 'run_name')).replace(runNamePrefix, ''), {
        trigger: {source: 'github_source'},
        event: {issue: {number: 42n}},
      }),
    ).toBe('#42');
  });

  it('references the GitHub issue a ticket loader passes', () => {
    const task = step(workflow(githubIssues), 'implement', 'task');
    const inputs = {...manualInputs, ticket_id: '42', identifier: 'issue-42'};

    const result = runStep(task, {trigger: {source: 'manual'}, run: {number: 7}, inputs});

    expect(result.outputs).toMatchObject({
      ticket_id: '42',
      identifier: 'issue-42',
      reference: 'Fixes #42',
    });
  });

  it.each([
    {name: 'adds the in-progress label', labels: ['bug'], updates: true},
    {
      name: 'skips an issue already in progress',
      labels: ['bug', 'replace-with-in-progress-label'],
      updates: false,
    },
  ])('$name to a GitHub issue before the fix', ({labels, updates}) => {
    const document = workflow(githubIssues);
    const steps = at(document, 'jobs', 'implement', 'steps') as YamlRecord[];
    const mark = step(document, 'implement', 'mark_in_progress');
    const context = {
      steps: {
        task: {outputs: {ticket_id: '42'}},
        prepare: {outputs: {owner: 'acme', repo: 'api'}},
        read_labels: {outputs: {labels}},
      },
    };

    expect(evaluate(mark.if, context)).toBe(updates);
    expect(evaluate(at(mark, 'with', 'issue_number'), context)).toBe(42n);
    expect(evaluate(at(mark, 'with', 'labels'), context)).toEqual([
      ...labels,
      'replace-with-in-progress-label',
    ]);
    expect(steps.findIndex((entry) => entry.key === 'mark_in_progress')).toBeLessThan(
      steps.findIndex((entry) => entry.key === 'fix'),
    );
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

  it.each([
    'task-7',
    'CU-86abc',
  ])('refuses task %s for another repository before touching the remote', (identifier) => {
    const root = tempRoot();
    const git = (...args: string[]) => execFileSync('git', args, {cwd: root, encoding: 'utf8'});
    git('init', '--quiet');
    git('remote', 'add', 'origin', 'https://github.com/acme/api.git');
    const prepare = step(workflow(manualOnly), 'implement', 'prepare');

    const result = runStep(
      prepare,
      {
        steps: {task: {outputs: {identifier, repository: 'acme/web'}}},
        run: {number: 7, attempt: 1},
      },
      root,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'The task names acme/web, but this project checks out acme/api.',
    );
  });

  it('names the branch after a Jira key with an underscore', () => {
    const root = tempRoot();
    const remote = join(root, 'github.com', 'acme', 'api.git');
    const checkout = join(root, 'checkout');
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, {cwd, encoding: 'utf8'});
    git(root, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
    git(root, 'init', '--quiet', '--initial-branch=main', checkout);
    git(
      checkout,
      '-c',
      'user.name=Test',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'init',
    );
    git(checkout, 'remote', 'add', 'origin', remote);
    git(checkout, 'push', '--quiet', 'origin', 'main');
    const prepare = step(workflow(jira), 'implement', 'prepare');

    const result = runStep(
      prepare,
      {
        steps: {task: {outputs: {identifier: 'PROJ_1-123', repository: ''}}},
        run: {number: 7, attempt: 1},
      },
      checkout,
    );

    expect(result.status).toBe(0);
    expect(result.outputs).toEqual({
      branch: 'shipfox/PROJ_1-123-7-1',
      base: 'main',
      repository: 'acme/api',
      owner: 'acme',
      repo: 'api',
    });
  });
});
