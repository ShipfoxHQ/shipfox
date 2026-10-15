import {parseWorkflowTemplate} from '../template/parse-workflow-template.js';
import {planInterpolationField} from './plan-field.js';

const templateOpen = '$' + '{{';
const templateClose = '}' + '}';

function templateExpression(source: string): string {
  return `${templateOpen}${source}${templateClose}`;
}

describe('planInterpolationField', () => {
  const templateExpressionOpen = '$' + '{{';
  const runnerRootNotBareHint = `split runner-host references into their own adjacent ${templateExpressionOpen} }} segments`;

  it('plans literal-only fields as frozen config with the field failure policy', () => {
    const segments = parseWorkflowTemplate('deploy main');

    const result = planInterpolationField({field: 'env.value', segments});

    expect(result).toEqual({
      ok: true,
      plan: {
        failurePolicy: 'fail',
        field: {segments: [{kind: 'literal', value: 'deploy main'}]},
      },
    });
  });

  it('routes same-site roots to one deferred segment targeting that site', () => {
    const segments = parseWorkflowTemplate(templateExpression(' run.id + "-" + trigger.event '));

    const result = planInterpolationField({field: 'workflow.run_name', segments});

    expect(result).toMatchObject({
      ok: true,
      plan: {
        failurePolicy: 'degrade',
        field: {
          segments: [
            {
              kind: 'deferred',
              roots: ['run', 'trigger'],
              fillTarget: 'run-creation',
            },
          ],
        },
      },
    });
  });

  it('applies field minimum fill targets', () => {
    const segments = parseWorkflowTemplate(templateExpression(' steps.build.outputs.sha '));

    const result = planInterpolationField({field: 'job.outputs', segments});

    expect(result).toMatchObject({
      ok: true,
      plan: {
        failurePolicy: 'fail',
        field: {
          segments: [
            {
              kind: 'deferred',
              roots: ['steps'],
              fillTarget: 'execution-resolution',
            },
          ],
        },
      },
    });
  });

  it.each([
    ['event.repository.name', 'event', 'ingest'],
    ['run.id', 'run', 'run-creation'],
    ['jobs.build.outputs.sha', 'jobs', 'job-activation'],
    ['steps.build.outputs.sha', 'steps', 'step-dispatch'],
  ] as const)('routes tool input %s at its natural availability site', (source, root, fillTarget) => {
    const segments = parseWorkflowTemplate(templateExpression(source));

    const result = planInterpolationField({field: 'tool.with', segments});

    expect(result).toMatchObject({
      ok: true,
      plan: {
        failurePolicy: 'fail',
        field: {
          segments: [
            {
              kind: 'deferred',
              roots: [root],
              fillTarget,
            },
          ],
        },
      },
    });
  });

  it('keeps template segment boundaries while assigning fill targets', () => {
    const segments = parseWorkflowTemplate(
      `${templateExpression(' run.id ')}-${templateExpression(' trigger.event ')}`,
    );

    const result = planInterpolationField({field: 'env.value', segments});

    expect(result).toMatchObject({
      ok: true,
      plan: {
        field: {
          segments: [
            {kind: 'deferred', roots: ['run'], fillTarget: 'run-creation'},
            {kind: 'literal', value: '-'},
            {kind: 'deferred', roots: ['trigger'], fillTarget: 'ingest'},
          ],
        },
      },
    });
  });

  it('plans the runner context as a server context filled at step dispatch', () => {
    const segments = parseWorkflowTemplate(
      templateExpression(' runner.arch == "arm64" ? "aarch64" : "x86_64" '),
    );

    const result = planInterpolationField({field: 'env.value', segments});

    expect(result).toMatchObject({
      ok: true,
      plan: {
        field: {
          segments: [{kind: 'deferred', roots: ['runner'], fillTarget: 'step-dispatch'}],
        },
      },
    });
  });

  it('plans a hashFiles() call as a runner-fill segment that records its patterns', () => {
    const segments = parseWorkflowTemplate(
      `npm-${templateExpression(" hashFiles('**/package-lock.json', 'pnpm-workspace.yaml') ")}`,
    );

    const result = planInterpolationField({field: 'action.with', segments});

    expect(result).toMatchObject({
      ok: true,
      plan: {
        field: {
          segments: [
            {kind: 'literal', value: 'npm-'},
            {
              kind: 'deferred',
              roots: [],
              fillTarget: 'runner-fill',
              runnerCall: {
                function: 'hashFiles',
                patterns: ['**/package-lock.json', 'pnpm-workspace.yaml'],
              },
            },
          ],
        },
      },
    });
  });

  it.each([
    ['"npm-" + hashFiles("x")', 'runner-call-not-bare'],
    ['hashFiles("x") + secrets.TOKEN', 'runner-call-not-bare'],
    ['hashFiles(vars.LOCK)', 'runner-call-argument-not-literal'],
  ])('rejects the hashFiles() call %s', (source, reason) => {
    const segments = parseWorkflowTemplate(templateExpression(source));

    const result = planInterpolationField({field: 'run', segments});

    expect(result).toMatchObject({
      ok: false,
      violations: [{reason, source, function: 'hashFiles'}],
    });
  });

  it.each([
    ["hashFiles('~/.npmrc')", '~/.npmrc'],
    ["hashFiles('/etc/hosts')", '/etc/hosts'],
    ["hashFiles('../lock.json')", '../lock.json'],
    ["hashFiles('a', 'src/../../b')", 'src/../../b'],
  ])('rejects a hashFiles() path outside the workspace: %s', (source, pattern) => {
    const segments = parseWorkflowTemplate(templateExpression(source));

    const result = planInterpolationField({field: 'env.value', segments});

    expect(result).toMatchObject({
      ok: false,
      violations: [{reason: 'runner-call-pattern-outside-workspace', source, pattern}],
    });
  });

  it('rejects an empty hashFiles() path', () => {
    const segments = parseWorkflowTemplate(templateExpression("hashFiles(' ')"));

    const result = planInterpolationField({field: 'env.value', segments});

    expect(result).toMatchObject({
      ok: false,
      violations: [{reason: 'runner-call-pattern-invalid', pattern: ' '}],
    });
  });

  it.each([
    'tool.with',
    'agent.prompt',
    'job.container.env.value',
    'step.name',
  ] as const)('rejects hashFiles() in %s', (field) => {
    const segments = parseWorkflowTemplate(templateExpression('hashFiles("x")'));

    const result = planInterpolationField({field, segments});

    expect(result).toEqual({
      ok: false,
      violations: [
        {
          reason: 'runner-call-in-field',
          source: 'hashFiles("x")',
          function: 'hashFiles',
          hint: 'hashFiles() runs on the runner. Use it in env, with, or run',
        },
      ],
    });
  });

  it('allows a bare secret reference as a runner-fill deferred segment', () => {
    const segments = parseWorkflowTemplate(templateExpression(' secrets.TOKEN '));

    const result = planInterpolationField({field: 'env.value', segments});

    expect(result).toMatchObject({
      ok: true,
      plan: {
        field: {
          segments: [
            {
              kind: 'deferred',
              roots: ['secrets'],
              fillTarget: 'runner-fill',
            },
          ],
        },
      },
    });
  });

  it('allows vars references inside larger expressions', () => {
    const segments = parseWorkflowTemplate(templateExpression(' "eu-" + vars.REGION '));

    const result = planInterpolationField({field: 'env.value', segments});

    expect(result).toMatchObject({
      ok: true,
      plan: {
        field: {
          segments: [
            {
              kind: 'deferred',
              roots: ['vars'],
              fillTarget: 'run-creation',
            },
          ],
        },
      },
    });
  });

  it.each([
    'secrets.TOKEN + steps.build.outputs.sha',
    'secrets.A + secrets.B',
    'secrets.TOKEN == "x"',
  ])('rejects runner-host expressions that are not bare references: %s', (source) => {
    const segments = parseWorkflowTemplate(templateExpression(source));

    const result = planInterpolationField({field: 'env.value', segments});

    expect(result).toEqual({
      ok: false,
      violations: [
        {
          reason: 'runner-root-not-bare',
          source,
          runnerRoots: ['secrets'],
          hint: runnerRootNotBareHint,
        },
      ],
    });
  });

  it.each([
    'vars[event.name]',
    'secrets[event.name]',
  ])('rejects computed context keys: %s', (source) => {
    const segments = parseWorkflowTemplate(templateExpression(source));

    const result = planInterpolationField({field: 'env.value', segments});

    expect(result).toEqual({
      ok: false,
      violations: [
        {
          reason: 'computed-context-key',
          source,
          contextRoots: [source.startsWith('vars') ? 'vars' : 'secrets'],
          hint: `${source.startsWith('vars') ? 'vars' : 'secrets'} references must use a literal dot key`,
        },
      ],
    });
  });

  it('routes alias-shadowed runner references on their free context root only', () => {
    const segments = parseWorkflowTemplate(
      templateExpression(' executions.all(runner, runner.status == "succeeded") '),
    );

    const result = planInterpolationField({field: 'env.value', segments});

    expect(result).toMatchObject({
      ok: true,
      plan: {
        field: {
          segments: [
            {
              kind: 'deferred',
              roots: ['executions'],
              fillTarget: 'execution-creation',
            },
          ],
        },
      },
    });
  });

  it('round-trips a field plan through JSON', () => {
    const segments = parseWorkflowTemplate(
      `prefix-${templateExpression(' run.id ')}-${templateExpression(' secrets.TOKEN ')}`,
    );
    const result = planInterpolationField({field: 'env.value', segments});

    const roundTripped = JSON.parse(JSON.stringify(result));

    expect(roundTripped).toEqual(result);
  });
});
