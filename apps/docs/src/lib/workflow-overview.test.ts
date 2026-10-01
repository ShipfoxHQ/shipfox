import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {describeWorkflowStep, serializeWorkflowOverview, workflowSteps} from './workflow-overview';

describe('workflow overview', () => {
  it('describes an agent step with its model, scope, and cost', () => {
    assert.equal(
      describeWorkflowStep(workflowSteps[0]),
      'Triage: agent step on GLM 5.3, reads Linear, costs about $0.01.',
    );
  });

  it('names the step a failing step goes back to', () => {
    const tests = workflowSteps.find((step) => step.loopsTo !== undefined);
    assert.ok(tests);
    assert.equal(
      describeWorkflowStep(tests),
      'npm test: run step. If it fails, the workflow goes back to Fix issues.',
    );
  });

  it('serializes every step in order', () => {
    const markdown = serializeWorkflowOverview();
    const positions = workflowSteps.map((step) => markdown.indexOf(describeWorkflowStep(step)));
    assert.ok(positions.every((position) => position >= 0));
    assert.deepEqual(
      positions,
      [...positions].sort((a, b) => a - b),
    );
  });
});
