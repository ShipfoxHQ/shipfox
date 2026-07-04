import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
import {
  type AvailabilitySite,
  unavailableRootsAt,
  type WorkflowContextName,
} from '../workflow-context/workflow-context.js';
import {routeExpression} from './route-expression.js';

describe('routeExpression', () => {
  it.each([
    ['1 + 1', [], [], 'ingest'],
    ['run.id', ['run'], [], 'run-creation'],
    ['run.id + execution.name', ['execution', 'run'], [], 'execution-creation'],
    ['steps.build.outputs.sha', ['steps'], [], 'step-dispatch'],
    ['step.status', ['step'], [], 'step-report'],
    ['runner.os', ['runner'], ['runner'], 'runner-fill'],
    ['runner.os + step.status', ['runner', 'step'], ['runner'], 'runner-fill'],
    ['typo_root.value + run.id', ['run', 'typo_root'], [], 'run-creation'],
  ])('routes %s from known roots to %s', (source, roots, runnerRoots, fillTarget) => {
    const expression = createWorkflowExpression({source, check: {mode: 'syntax'}});

    const route = routeExpression(expression);

    expect(route).toEqual({roots, runnerRoots, fillTarget});
  });

  it.each([
    'run.id',
    'run.id + execution.name',
    'step.status',
  ])('does not target a server site before %s roots are available', (source) => {
    const expression = createWorkflowExpression({source, check: {mode: 'syntax'}});

    const route = routeExpression(expression);

    expect(
      unavailableRootsAt(
        route.roots as WorkflowContextName[],
        route.fillTarget as AvailabilitySite,
      ),
    ).toEqual([]);
  });
});
