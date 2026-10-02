import {describe, expect, it} from '@shipfox/vitest/vi';
import {fillSlots} from './compose.js';
import type {McpCallRecord} from './mcp-calls.js';
import {
  countQuestions,
  type GradeOnboardingRunOptions,
  gradeOnboardingRun,
  type OnboardingCheck,
} from './onboarding-checks.js';
import {composeExpectedVariant} from './onboarding-evidence.js';
import type {OnboardingExpect} from './onboarding-schema.js';

const SLOTS = {setup_commands: '- key: setup\n  run: npm ci', test_command: 'npm test'};
const GITHUB_SOURCE =
  /^(\s*(?:-\s+)?(?:source|connection):\s*)github_source(\s+# bind:source)?$/gmu;
const START = Date.parse('2026-09-30T10:00:00.000Z');
const WORKFLOW_PATH = '.shipfox/workflows/ticket-to-pr.yml';
const CATALOG = ['gpt-6-luna', 'glm-5.3-flash'];

const TEMPLATE_EXPECT: OnboardingExpect = {
  outcome: 'validated',
  template: 'shipfox/ticket-to-pr',
  bindings: {source: 'github'},
  max_questions: 3,
};

function at(seconds: number): string {
  return new Date(START + seconds * 1_000).toISOString();
}

function call(tool: string, args: unknown, seconds: number, status = 'ok'): McpCallRecord {
  return {
    sessionId: 'session',
    method: 'tools/call',
    tool,
    arguments: args,
    status,
    httpStatus: 200,
    startedAt: at(seconds),
    durationMs: 100,
  } as McpCallRecord;
}

function transcript(entries: object[]): string {
  return `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
}

function asking(question: string, seconds: number): object {
  return {type: 'result', subtype: 'success', result: question, timestamp: at(seconds)};
}

function writing(path: string, seconds: number): object {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    timestamp: at(seconds),
    message: {content: [{type: 'tool_use', name: 'Write', input: {file_path: path}}]},
  };
}

async function writtenWorkflow(): Promise<{expected: string; written: string}> {
  const expected = await composeExpectedVariant({expected: TEMPLATE_EXPECT});
  const written = fillSlots({yaml: expected, slots: SLOTS}).replace(GITHUB_SOURCE, '$1acme-github');
  return {expected, written};
}

/** A run that did everything right for the template case. */
async function validatedRun(): Promise<GradeOnboardingRunOptions> {
  const {expected, written} = await writtenWorkflow();
  return {
    expect: TEMPLATE_EXPECT,
    session: {stop_reason: 'completed', final_message: 'The workflow pull request is open.'},
    transcript_jsonl: transcript([
      asking('Should I open the pull request now?', 30),
      writing(`/tmp/checkout/${WORKFLOW_PATH}`, 20),
    ]),
    mcp_calls: [call('get_workflow_template', {template_id: 'ticket-to-pr'}, 10)],
    written_files: [{path: WORKFLOW_PATH, content: written}],
    evidence: {
      dry_runs: [{trigger: 'manual', passed: true}],
      workspace_models: CATALOG,
      expected_yaml: expected,
    },
  };
}

function withoutTemplateHeader(yaml: string): string {
  return yaml
    .split('\n')
    .filter((line) => !line.startsWith('# shipfox-template:'))
    .join('\n');
}

function failed(checks: OnboardingCheck[]): string[] {
  return checks.filter((entry) => !entry.passed).map((entry) => entry.id);
}

function stoppedRun(overrides: Partial<GradeOnboardingRunOptions>): GradeOnboardingRunOptions {
  return {
    expect: {outcome: 'needs_clarification'},
    session: {stop_reason: 'completed', final_message: 'What do you want to speed up?'},
    transcript_jsonl: transcript([asking('What do you want to speed up?', 5)]),
    mcp_calls: [call('list_projects', {}, 1)],
    written_files: [],
    evidence: {},
    ...overrides,
  };
}

describe('validated outcome', () => {
  it('passes a run with a passing dry run and every template check', async () => {
    const grade = gradeOnboardingRun(await validatedRun());

    expect(failed(grade.checks)).toEqual([]);
    expect(grade.passed).toBe(true);
    expect(grade.checks.map((entry) => entry.id)).toEqual([
      'ended_on_its_own',
      'workflow_file',
      'dry_run',
      'no_placeholder',
      'models_in_catalog',
      'header',
      'template_fetch',
      'template_fidelity',
      'max_questions',
    ]);
  });

  it('fails a run whose dry run is refused, with the reason', async () => {
    const run = await validatedRun();

    const grade = gradeOnboardingRun({
      ...run,
      evidence: {
        ...run.evidence,
        dry_runs: [{trigger: 'manual', passed: false, detail: 'invalid-definition: jobs.a.steps'}],
      },
    });

    expect(failed(grade.checks)).toEqual(['dry_run']);
    expect(grade.checks.find((entry) => entry.id === 'dry_run')?.detail).toContain(
      'invalid-definition',
    );
    expect(grade.passed).toBe(false);
  });

  it('fails when no workflow file was written', async () => {
    const run = await validatedRun();

    const grade = gradeOnboardingRun({...run, written_files: []});

    expect(failed(grade.checks)).toEqual(['workflow_file']);
  });

  it('fails a placeholder and a model outside the catalog', async () => {
    const run = await validatedRun();
    const [file] = run.written_files;
    if (file === undefined) throw new Error('The fixture run writes a file.');

    const grade = gradeOnboardingRun({
      ...run,
      written_files: [
        {
          ...file,
          content: `${file.content}\n# run: replace-with-test-command\n    model: made-up-model\n`,
        },
      ],
    });

    expect(failed(grade.checks)).toEqual(
      expect.arrayContaining(['no_placeholder', 'models_in_catalog']),
    );
    expect(grade.checks.find((entry) => entry.id === 'models_in_catalog')?.detail).toContain(
      'made-up-model',
    );
  });

  it('fails a header that names another binding', async () => {
    const run = await validatedRun();
    const [file] = run.written_files;
    if (file === undefined) throw new Error('The fixture run writes a file.');

    const grade = gradeOnboardingRun({
      ...run,
      written_files: [
        {...file, content: file.content.replace('source=github', 'tracker=linear source=github')},
      ],
    });

    expect(failed(grade.checks)).toContain('header');
  });

  it('fails a workflow with no template header', async () => {
    const run = await validatedRun();
    const [file] = run.written_files;
    if (file === undefined) throw new Error('The fixture run writes a file.');

    const grade = gradeOnboardingRun({
      ...run,
      written_files: [
        {
          ...file,
          content: withoutTemplateHeader(file.content),
        },
      ],
    });

    expect(failed(grade.checks)).toContain('header');
  });

  it('fails when the template was fetched after the file was written', async () => {
    const run = await validatedRun();

    const grade = gradeOnboardingRun({
      ...run,
      mcp_calls: [call('get_workflow_template', {template_id: 'ticket-to-pr'}, 25)],
    });

    expect(failed(grade.checks)).toEqual(['template_fetch']);
  });

  it('fails when the template was never fetched or the fetch failed', async () => {
    const run = await validatedRun();

    const never = gradeOnboardingRun({...run, mcp_calls: []});
    const refused = gradeOnboardingRun({
      ...run,
      mcp_calls: [call('get_workflow_template', {template_id: 'ticket-to-pr'}, 10, 'tool_error')],
    });

    expect(failed(never.checks)).toEqual(['template_fetch']);
    expect(failed(refused.checks)).toEqual(['template_fetch']);
  });

  it('fails a workflow whose template body was edited', async () => {
    const run = await validatedRun();
    const [file] = run.written_files;
    if (file === undefined) throw new Error('The fixture run writes a file.');

    const grade = gradeOnboardingRun({
      ...run,
      written_files: [{...file, content: file.content.replace('source: manual', 'source: cron')}],
    });

    expect(failed(grade.checks)).toEqual(['template_fidelity']);
    expect(grade.checks.find((entry) => entry.id === 'template_fidelity')?.detail).toContain(
      '+ source: cron',
    );
  });

  it('passes a plain workflow when the case sets no template', async () => {
    const run = await validatedRun();
    const [file] = run.written_files;
    if (file === undefined) throw new Error('The fixture run writes a file.');

    const grade = gradeOnboardingRun({
      ...run,
      expect: {outcome: 'validated'},
      mcp_calls: [],
      written_files: [{...file, content: withoutTemplateHeader(file.content)}],
    });

    expect(grade.checks.map((entry) => entry.id)).toEqual([
      'ended_on_its_own',
      'workflow_file',
      'dry_run',
      'no_placeholder',
      'models_in_catalog',
      'no_template_header',
    ]);
    expect(grade.passed).toBe(true);
  });

  it('fails a template-derived workflow when the case sets no template', async () => {
    const run = await validatedRun();

    const grade = gradeOnboardingRun({...run, expect: {outcome: 'validated'}});

    expect(failed(grade.checks)).toEqual(['no_template_header']);
    expect(grade.passed).toBe(false);
  });

  it('fails a session that stopped at a limit before it finished', async () => {
    const run = await validatedRun();

    const grade = gradeOnboardingRun({
      ...run,
      session: {...run.session, stop_reason: 'max_turns'},
    });

    expect(failed(grade.checks)).toEqual(['ended_on_its_own']);
  });

  it('fails a run that asks more than max_questions', async () => {
    const run = await validatedRun();

    const grade = gradeOnboardingRun({
      ...run,
      transcript_jsonl: transcript([
        asking('One?', 1),
        asking('Two?', 2),
        asking('Three?', 3),
        asking('Four?', 4),
        writing(WORKFLOW_PATH, 20),
      ]),
    });

    expect(failed(grade.checks)).toEqual(['max_questions']);
  });
});

describe('blocked_on_connection outcome', () => {
  const blocked = {outcome: 'blocked_on_connection', missing_provider: 'linear'} as const;

  it('passes a run that writes nothing and names the provider to connect', () => {
    const grade = gradeOnboardingRun(
      stoppedRun({
        expect: blocked,
        session: {
          stop_reason: 'completed',
          final_message: 'Connect Linear in the Shipfox dashboard, then ask me again.',
        },
      }),
    );

    expect(failed(grade.checks)).toEqual([]);
    expect(grade.checks.map((entry) => entry.id)).toEqual([
      'ended_on_its_own',
      'no_workflow_file',
      'no_write_tool',
      'names_missing_provider',
    ]);
  });

  it('fails a run that writes a workflow, starts a run, and does not name the provider', () => {
    const grade = gradeOnboardingRun(
      stoppedRun({
        expect: blocked,
        session: {stop_reason: 'completed', final_message: 'All done.'},
        mcp_calls: [
          call('create_dev_run', {dry_run: false}, 5),
          call('create_dev_run', {dry_run: true}, 4),
        ],
        written_files: [{path: WORKFLOW_PATH, content: 'name: x'}],
      }),
    );

    expect(failed(grade.checks)).toEqual([
      'no_workflow_file',
      'no_write_tool',
      'names_missing_provider',
    ]);
    expect(grade.checks.find((entry) => entry.id === 'no_write_tool')?.detail).toBe(
      'Called: create_dev_run.',
    );
  });
});

describe('needs_clarification outcome', () => {
  it('passes a run that asks and writes nothing, and allows a dry run', () => {
    const grade = gradeOnboardingRun(
      stoppedRun({mcp_calls: [call('create_dev_run', {dry_run: true}, 5)]}),
    );

    expect(failed(grade.checks)).toEqual([]);
    expect(grade.checks.map((entry) => entry.id)).toEqual([
      'ended_on_its_own',
      'no_workflow_file',
      'no_write_tool',
    ]);
  });

  it('fails a run that wrote a workflow file and deleted it before the files were collected', () => {
    const grade = gradeOnboardingRun(
      stoppedRun({
        transcript_jsonl: transcript([
          writing(`/tmp/checkout/${WORKFLOW_PATH}`, 3),
          asking('What do you want to speed up?', 5),
        ]),
      }),
    );

    expect(failed(grade.checks)).toEqual(['no_workflow_file']);
    expect(grade.checks.find((entry) => entry.id === 'no_workflow_file')?.detail).toContain(
      'removed',
    );
  });

  it('fails a run that guessed a workflow and fired a trigger', () => {
    const grade = gradeOnboardingRun(
      stoppedRun({
        mcp_calls: [call('fire_manual_trigger', {definition_id: 'd'}, 5)],
        written_files: [{path: WORKFLOW_PATH, content: 'name: x'}],
      }),
    );

    expect(failed(grade.checks)).toEqual(['no_workflow_file', 'no_write_tool']);
    expect(grade.passed).toBe(false);
  });

  it('applies max_questions to a stopped outcome too', () => {
    const grade = gradeOnboardingRun(
      stoppedRun({
        expect: {outcome: 'needs_clarification', max_questions: 1},
        transcript_jsonl: transcript([asking('One?', 1), asking('Two?', 2)]),
      }),
    );

    expect(failed(grade.checks)).toEqual(['max_questions']);
  });
});

describe('countQuestions', () => {
  it('counts the turns that ended with a question', () => {
    const jsonl = transcript([
      asking('Which tracker do you use?', 1),
      {type: 'user', message: {role: 'user', content: 'Linear'}},
      {type: 'assistant', message: {content: [{type: 'text', text: 'Is this ok?'}]}},
      asking('Should I open the pull request now?\n\nIt only adds the file.', 2),
      asking('Done, the pull request is open.', 3),
      {type: 'result', subtype: 'error_max_turns', result: 'Really?'},
    ]);

    expect(countQuestions(jsonl)).toBe(1);
  });

  it('counts a message once however many question marks it holds', () => {
    expect(countQuestions(transcript([asking('Which team? Which project?', 1)]))).toBe(1);
  });

  it('ignores a line that is not JSON', () => {
    expect(countQuestions(`not json\n${JSON.stringify(asking('Ready?', 1))}\n`)).toBe(1);
  });
});
