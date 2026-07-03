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

    const result = planInterpolationField({field: 'job.name', segments});

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
            {kind: 'deferred', roots: ['trigger'], fillTarget: 'run-creation'},
          ],
        },
      },
    });
  });

  it('allows a bare runner reference as a runner-fill deferred segment', () => {
    const segments = parseWorkflowTemplate(templateExpression(' runner.os '));

    const result = planInterpolationField({field: 'env.value', segments});

    expect(result).toMatchObject({
      ok: true,
      plan: {
        field: {
          segments: [
            {
              kind: 'deferred',
              roots: ['runner'],
              fillTarget: 'runner-fill',
            },
          ],
        },
      },
    });
  });

  it.each([
    'runner.os + steps.build.outputs.sha',
    'runner.os + runner.arch',
    'runner',
  ])('rejects runner-host expressions that are not bare references: %s', (source) => {
    const segments = parseWorkflowTemplate(templateExpression(source));

    const result = planInterpolationField({field: 'env.value', segments});

    expect(result).toEqual({
      ok: false,
      violations: [
        {
          reason: 'runner-root-not-bare',
          source,
          runnerRoots: ['runner'],
          hint: runnerRootNotBareHint,
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
      `prefix-${templateExpression(' run.id ')}-${templateExpression(' runner.os ')}`,
    );
    const result = planInterpolationField({field: 'env.value', segments});

    const roundTripped = JSON.parse(JSON.stringify(result));

    expect(roundTripped).toEqual(result);
  });
});
