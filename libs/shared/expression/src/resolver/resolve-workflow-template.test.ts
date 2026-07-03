import {WorkflowExpressionEvaluationError} from '../evaluator/errors.js';
import {parseWorkflowTemplate} from '../template/parse-workflow-template.js';
import {WorkflowTemplateResolutionError} from './errors.js';
import {
  resolveWorkflowTemplate,
  resolveWorkflowTemplateSource,
} from './resolve-workflow-template.js';

const templateOpen = '$' + '{{';
const templateClose = '}' + '}';

function templateExpression(source: string): string {
  return `${templateOpen}${source}${templateClose}`;
}

describe('resolveWorkflowTemplate', () => {
  it('returns literal-only templates without diagnostics', () => {
    const segments = parseWorkflowTemplate('deploy main');

    const result = resolveWorkflowTemplate(segments, {});

    expect(result).toEqual({value: 'deploy main', diagnostics: []});
  });

  it('concatenates mixed literal and expression segments', () => {
    const segments = parseWorkflowTemplate(
      `refs/${templateExpression(' event.ref ')}/${templateExpression(' inputs.environment ')}`,
    );

    const result = resolveWorkflowTemplate(segments, {
      event: {ref: 'refs/heads/main'},
      inputs: {environment: 'prod'},
    });

    expect(result).toEqual({value: 'refs/refs/heads/main/prod', diagnostics: []});
  });

  it('coerces expression values through the resolver', () => {
    const source = [
      templateExpression(' 42 '),
      ':',
      templateExpression(' true '),
      ':',
      templateExpression(' event.metadata '),
    ].join('');

    const result = resolveWorkflowTemplateSource(source, {
      event: {
        metadata: {runner: 'macos', labels: ['ship']},
      },
    });

    expect(result).toEqual({
      value: '42:true:{"runner":"macos","labels":["ship"]}',
      diagnostics: [],
    });
  });

  it('resolves missing paths to empty strings with diagnostics', () => {
    const segments = parseWorkflowTemplate(
      `prefix-${templateExpression(' event.nope.deep ')}-suffix`,
    );

    const result = resolveWorkflowTemplate(segments, {
      event: {pull_request: {title: 'Fix auth'}},
    });

    expect(result).toEqual({
      value: 'prefix--suffix',
      diagnostics: [
        {
          reason: 'missing-path',
          expression: 'event.nope.deep',
          contextRoots: ['event'],
        },
      ],
    });
  });

  it('resolves null event paths to empty strings with diagnostics', () => {
    const segments = parseWorkflowTemplate(`manual-${templateExpression(' event.ref ')}`);

    const result = resolveWorkflowTemplate(segments, {event: null});

    expect(result).toEqual({
      value: 'manual-',
      diagnostics: [
        {
          reason: 'missing-path',
          expression: 'event.ref',
          contextRoots: ['event'],
        },
      ],
    });
  });

  it('resolves absent context roots to empty strings with diagnostics', () => {
    const segments = parseWorkflowTemplate(`push-${templateExpression(' inputs.environment ')}`);

    const result = resolveWorkflowTemplate(segments, {event: {}});

    expect(result).toEqual({
      value: 'push-',
      diagnostics: [
        {
          reason: 'missing-path',
          expression: 'inputs.environment',
          contextRoots: ['inputs'],
        },
      ],
    });
  });

  it('wraps genuine evaluation exceptions in resolution errors', () => {
    const segments = parseWorkflowTemplate(templateExpression(' 1 / 0 '));

    let error: unknown;
    try {
      resolveWorkflowTemplate(segments, {});
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(WorkflowTemplateResolutionError);
    expect(error).toMatchObject({
      code: 'workflow-template-resolution-failed',
      name: 'WorkflowTemplateResolutionError',
      source: '1 / 0',
    });
    expect((error as WorkflowTemplateResolutionError).cause).toBeInstanceOf(
      WorkflowExpressionEvaluationError,
    );
  });

  it('wraps missing paths for fail-policy available roots in resolution errors', () => {
    const segments = parseWorkflowTemplate(`run-${templateExpression(' run.id ')}`);

    let error: unknown;
    try {
      resolveWorkflowTemplate(
        segments,
        {run: {}},
        {failurePolicy: 'fail', availableRoots: ['run']},
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(WorkflowTemplateResolutionError);
    expect(error).toMatchObject({
      code: 'workflow-template-resolution-failed',
      name: 'WorkflowTemplateResolutionError',
      source: 'run.id',
    });
    expect((error as WorkflowTemplateResolutionError).cause).toBeInstanceOf(
      WorkflowExpressionEvaluationError,
    );
  });

  it('ignores over-included non-workflow roots when applying fail-policy availability', () => {
    const segments = parseWorkflowTemplate(templateExpression(' {foo: event.ref}.foo '));

    let error: unknown;
    try {
      resolveWorkflowTemplate(
        segments,
        {event: {}},
        {failurePolicy: 'fail', availableRoots: ['event']},
      );
    } catch (caught) {
      error = caught;
    }

    expect(segments[0]).toMatchObject({kind: 'expr', contextRoots: ['event', 'foo']});
    expect(error).toBeInstanceOf(WorkflowTemplateResolutionError);
    expect(error).toMatchObject({
      code: 'workflow-template-resolution-failed',
      name: 'WorkflowTemplateResolutionError',
      source: '{foo: event.ref}.foo',
    });
  });

  it('degrades fail-policy missing paths when a segment root is not available yet', () => {
    const segments = parseWorkflowTemplate(
      `deploy-${templateExpression(' event.ref + execution.index ')}`,
    );

    const result = resolveWorkflowTemplate(
      segments,
      {
        event: {ref: 'refs/heads/main'},
        execution: {},
      },
      {failurePolicy: 'fail', availableRoots: ['event']},
    );

    expect(result).toEqual({
      value: 'deploy-',
      diagnostics: [
        {
          reason: 'missing-path',
          expression: 'event.ref + execution.index',
          contextRoots: ['event', 'execution'],
        },
      ],
    });
  });

  it('resolves caller-provided context sets without a hard-coded context list', () => {
    const source = `artifact:${templateExpression(' steps.build.output ')}`;

    const result = resolveWorkflowTemplateSource(source, {
      steps: {
        build: {
          output: 'dist/app.tar.gz',
        },
      },
    });

    expect(result).toEqual({value: 'artifact:dist/app.tar.gz', diagnostics: []});
  });
});
