import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
import {InvalidWorkflowExpressionError} from '../expression/errors.js';
import {
  getWorkflowContextTypeEnvironment,
  type WorkflowContextName,
  type WorkflowContextTrustTier,
  type WorkflowInterpolationField,
  workflowContextDefinitions,
  workflowContextNames,
  workflowContextTrustTiers,
  workflowInterpolationFieldAcceptsContext,
  workflowInterpolationFieldAcceptsTrustTier,
  workflowInterpolationFieldPolicies,
  workflowInterpolationFields,
} from './workflow-context.js';

describe('workflow context registry', () => {
  it('defines exactly the v1 contexts', () => {
    expect(workflowContextNames).toEqual([
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
    ]);
  });

  it('classifies trusted and untrusted contexts', () => {
    const contextsByTrust = workflowContextNames.reduce(
      (acc, context) => {
        acc[workflowContextDefinitions[context].trustTier].push(context);
        return acc;
      },
      {
        trusted: [] as WorkflowContextName[],
        untrusted: [] as WorkflowContextName[],
      },
    );

    expect(contextsByTrust.trusted).toEqual(['run', 'trigger', 'job', 'executions', 'execution']);
    expect(contextsByTrust.untrusted).toEqual(['event', 'inputs']);
  });

  it('marks known-shape contexts as typed and open contexts as syntax-only', () => {
    expect(workflowContextDefinitions.run).toMatchObject({
      shape: 'known',
      checkMode: 'typed',
    });
    expect(workflowContextDefinitions.trigger).toMatchObject({
      shape: 'known',
      checkMode: 'typed',
    });
    expect(workflowContextDefinitions.job).toMatchObject({
      shape: 'known',
      checkMode: 'typed',
    });
    expect(workflowContextDefinitions.executions).toMatchObject({
      shape: 'known',
      checkMode: 'typed',
      untrustedPaths: ['events'],
    });
    expect(workflowContextDefinitions.execution).toMatchObject({
      shape: 'known',
      checkMode: 'typed',
      untrustedPaths: ['events'],
    });
    expect(workflowContextDefinitions.event).toMatchObject({
      shape: 'open',
      checkMode: 'syntax',
    });
    expect(workflowContextDefinitions.inputs).toMatchObject({
      shape: 'open',
      checkMode: 'syntax',
    });
  });

  it('exports type environments for the known v1 context fields', () => {
    expect(getWorkflowContextTypeEnvironment('run')).toEqual({
      run: {
        kind: 'object',
        fields: {
          id: 'string',
          name: 'string',
          definition_id: 'string',
          project_id: 'string',
          workspace_id: 'string',
          created_at: 'timestamp',
        },
      },
    });
    expect(getWorkflowContextTypeEnvironment('trigger')).toEqual({
      trigger: {
        kind: 'object',
        fields: {
          source: 'string',
          event: 'string',
        },
      },
    });
    expect(getWorkflowContextTypeEnvironment('job')).toEqual({
      job: {
        kind: 'object',
        fields: {
          key: 'string',
        },
      },
    });
  });

  it('does not expose type environments for open contexts', () => {
    expect(getWorkflowContextTypeEnvironment('event')).toBeUndefined();
    expect(getWorkflowContextTypeEnvironment('inputs')).toBeUndefined();
  });

  it('supports CEL type-checking against the known context fields', () => {
    const runExpression = createWorkflowExpression({
      source: 'run.created_at < timestamp("2026-01-01T00:00:00Z")',
      check: {mode: 'typed', typeEnvironment: workflowContextDefinitions.run.typeEnvironment},
    });
    const triggerExpression = createWorkflowExpression({
      source: 'trigger.source == "github" && trigger.event == "pull_request"',
      check: {mode: 'typed', typeEnvironment: workflowContextDefinitions.trigger.typeEnvironment},
    });
    const jobExpression = createWorkflowExpression({
      source: 'job.key == "review"',
      check: {mode: 'typed', typeEnvironment: workflowContextDefinitions.job.typeEnvironment},
    });
    const executionsExpression = createWorkflowExpression({
      source: 'executions[0].name == execution.name',
      check: {
        mode: 'typed',
        typeEnvironment: {
          ...workflowContextDefinitions.executions.typeEnvironment,
          ...workflowContextDefinitions.execution.typeEnvironment,
        },
      },
    });

    expect(runExpression.check).toBe('typed');
    expect(triggerExpression.check).toBe('typed');
    expect(jobExpression.check).toBe('typed');
    expect(executionsExpression.check).toBe('typed');
  });

  it('rejects unknown fields from known context type environments', () => {
    const act = () =>
      createWorkflowExpression({
        source: 'run.source.sha',
        check: {mode: 'typed', typeEnvironment: workflowContextDefinitions.run.typeEnvironment},
      });

    expect(act).toThrow(InvalidWorkflowExpressionError);
  });
});

describe('workflow interpolation field policies', () => {
  it('defines a policy for every interpolatable field', () => {
    expect(workflowInterpolationFields).toEqual([
      'run',
      'env.value',
      'agent.prompt',
      'agent.model',
      'agent.provider',
      'agent.thinking',
      'job.name',
      'step.name',
    ]);
    expect(Object.keys(workflowInterpolationFieldPolicies)).toEqual(workflowInterpolationFields);
  });

  it.each([
    ['run', ['trusted']],
    ['env.value', ['trusted', 'untrusted']],
    ['agent.prompt', ['trusted', 'untrusted']],
    ['agent.model', ['trusted']],
    ['agent.provider', ['trusted']],
    ['agent.thinking', ['trusted']],
    ['job.name', ['trusted', 'untrusted']],
    ['step.name', ['trusted', 'untrusted']],
  ] satisfies readonly [
    WorkflowInterpolationField,
    readonly WorkflowContextTrustTier[],
  ][])('allows %s interpolation from the expected trust tiers', (field, trustTiers) => {
    expect(workflowInterpolationFieldPolicies[field].acceptedTrustTiers).toEqual(trustTiers);
  });

  it('rejects untrusted contexts from trusted-only fields', () => {
    expect(workflowInterpolationFieldAcceptsTrustTier('run', 'untrusted')).toBe(false);
    expect(workflowInterpolationFieldAcceptsContext('run', 'event')).toBe(false);
    expect(workflowInterpolationFieldAcceptsContext('run', 'inputs')).toBe(false);
    expect(workflowInterpolationFieldAcceptsContext('agent.model', 'event')).toBe(false);
    expect(workflowInterpolationFieldAcceptsContext('agent.provider', 'inputs')).toBe(false);
    expect(workflowInterpolationFieldAcceptsContext('agent.thinking', 'event')).toBe(false);
  });

  it('accepts every context in any-trust fields', () => {
    for (const field of ['env.value', 'agent.prompt', 'job.name', 'step.name'] as const) {
      for (const context of workflowContextNames) {
        expect(workflowInterpolationFieldAcceptsContext(field, context)).toBe(true);
      }
    }
  });

  it('marks display names for render sanitization', () => {
    expect(workflowInterpolationFieldPolicies['job.name'].renderSanitize).toBe(true);
    expect(workflowInterpolationFieldPolicies['step.name'].renderSanitize).toBe(true);

    const nonDisplayFields = workflowInterpolationFields.filter(
      (field) => field !== 'job.name' && field !== 'step.name',
    );
    for (const field of nonDisplayFields) {
      expect(workflowInterpolationFieldPolicies[field].renderSanitize).toBe(false);
    }
  });

  it('uses only registered trust tiers in field policies', () => {
    for (const policy of Object.values(workflowInterpolationFieldPolicies)) {
      expect(policy.acceptedTrustTiers.length).toBeGreaterThan(0);
      for (const trustTier of policy.acceptedTrustTiers) {
        expect(workflowContextTrustTiers).toContain(trustTier);
      }
    }
  });
});
