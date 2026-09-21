import type {WorkflowModelToolStep} from '@shipfox/api-definitions-dto';
import {parseWorkflowTemplate, planInterpolationField} from '@shipfox/expression';
import {ToolConfigInvalidError} from '#core/errors.js';
import {resolveToolStepConfig} from './tool.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

function template(source: string): string {
  return `\${{ ${source} }}`;
}

function plannedToolField(source: string) {
  const result = planInterpolationField({
    field: 'tool.with',
    segments: parseWorkflowTemplate(source),
  });
  if (!result.ok) throw new Error('Expected a valid tool input field plan');
  return result.plan.field.segments;
}

const context: WorkflowEvaluationContext = {
  site: 'execution-creation',
  values: {event: {workflow: 'other.yml'}},
};

const toolSnapshot = {
  steps: [
    {
      jobKey: 'deploy',
      stepId: 'step-1',
      tool: {
        connectionId: 'connection-1',
        connectionSlug: 'github-main',
        provider: 'github',
        id: 'start_workflow_run',
        sensitivity: 'write' as const,
        sensitive: false,
        requiredScope: [],
        inputSchema: {type: 'object'},
      },
    },
  ],
};

function resolve(step: WorkflowModelToolStep) {
  return resolveToolStepConfig({
    step,
    jobKey: 'deploy',
    context,
    definitionId: 'definition-1',
    agentToolSnapshot: toolSnapshot,
  });
}

describe('resolveToolStepConfig', () => {
  it('rejects a stored secret destination that resolves differently from its authored value', () => {
    const step: WorkflowModelToolStep = {
      id: 'step-1',
      kind: 'tool',
      tool: {id: 'shipfox.start_workflow_run'},
      with: {
        workflow: template('event.workflow'),
        secrets: {DEPLOY_TOKEN: 'PROD_DEPLOY_TOKEN'},
      },
      templates: {
        with: {workflow: plannedToolField(template('event.workflow'))},
      },
    };

    expect(() => resolve(step)).toThrow(
      new ToolConfigInvalidError(
        'Resolved secret input destination "workflow" differs from its authored value.',
      ),
    );
  });

  it('keeps an interpolated workflow when the tool step has no secrets', () => {
    const step: WorkflowModelToolStep = {
      id: 'step-1',
      kind: 'tool',
      tool: {id: 'shipfox.start_workflow_run'},
      with: {workflow: template('event.workflow')},
      templates: {
        with: {workflow: plannedToolField(template('event.workflow'))},
      },
    };

    expect(resolve(step).config.tool).toMatchObject({
      with: {workflow: 'other.yml'},
    });
  });
});
