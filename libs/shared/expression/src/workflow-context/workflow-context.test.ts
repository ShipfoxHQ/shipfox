import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
import {InvalidWorkflowExpressionError} from '../expression/errors.js';
import {
  getWorkflowContextTypeEnvironment,
  rootsAvailableAt,
  type WorkflowContextName,
  type WorkflowContextPhase,
  type WorkflowContextTrustTier,
  type WorkflowInterpolationField,
  workflowContextAvailabilityReference,
  workflowContextDefinitions,
  workflowContextNames,
  workflowContextPhases,
  workflowContextReservedRoots,
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
      'step',
    ]);
  });

  it('keeps future phase roots reserved out of the referenceable registry', () => {
    expect(workflowContextReservedRoots).toEqual({
      steps: 'step-completion',
      jobs: 'job-resolution',
    });
    expect(workflowContextNames).toContain('step');
    expect(workflowContextNames).not.toContain('steps');
    expect(workflowContextNames).not.toContain('jobs');
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

    expect(contextsByTrust.trusted).toEqual([
      'run',
      'trigger',
      'job',
      'executions',
      'execution',
      'step',
    ]);
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
    expect(workflowContextDefinitions.step).toMatchObject({
      availability: 'step-completion',
      trustTier: 'trusted',
      shape: 'known',
      checkMode: 'typed',
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
    expect(getWorkflowContextTypeEnvironment('step')).toEqual({
      step: {
        kind: 'object',
        fields: {
          exit_code: 'int',
          status: 'string',
        },
      },
    });
  });

  it('does not expose type environments for open contexts', () => {
    expect(getWorkflowContextTypeEnvironment('event')).toBeUndefined();
    expect(getWorkflowContextTypeEnvironment('inputs')).toBeUndefined();
  });

  it('returns the roots available at each workflow phase', () => {
    expect(rootsAvailableAt('workflow-run-creation')).toEqual([
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
    ]);
    expect(rootsAvailableAt('job-execution-creation')).toEqual([
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
    ]);
    expect(rootsAvailableAt('step-completion')).toEqual([
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
      'step',
    ]);
    expect(rootsAvailableAt('job-resolution')).toEqual([
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
      'step',
    ]);
  });

  it('keeps workflow context availability monotonic across phases', () => {
    const phaseIndexes = new Map<WorkflowContextPhase, number>(
      workflowContextPhases.map((phase, index) => [phase, index]),
    );

    const phasePairs: readonly [WorkflowContextPhase, WorkflowContextPhase][] = [
      ['workflow-run-creation', 'job-execution-creation'],
      ['job-execution-creation', 'step-completion'],
      ['step-completion', 'job-resolution'],
    ];

    for (const [previousPhase, currentPhase] of phasePairs) {
      const previous = new Set(rootsAvailableAt(previousPhase));
      const current = new Set(rootsAvailableAt(currentPhase));

      for (const root of previous) {
        expect(current.has(root)).toBe(true);
      }
    }

    for (const root of workflowContextNames) {
      const availability = workflowContextDefinitions[root].availability;
      const available = rootsAvailableAt(availability);
      expect(available).toContain(root);
      expect(phaseIndexes.get(availability)).toBeDefined();
    }
  });

  it('generates an availability reference from the registry and reserved roots', () => {
    const expected = [
      ...workflowContextNames.map((root) => ({
        root,
        availability: workflowContextDefinitions[root].availability,
        reserved: false,
        availableAt: availableAtReference(workflowContextDefinitions[root].availability),
      })),
      ...Object.entries(workflowContextReservedRoots).map(([root, availability]) => ({
        root,
        availability,
        reserved: true,
        availableAt: availableAtReference(availability),
      })),
    ];

    expect(workflowContextAvailabilityReference()).toEqual(expected);
    expect(workflowContextAvailabilityReference()).toMatchInlineSnapshot(`
      [
        {
          "availability": "workflow-run-creation",
          "availableAt": {
            "job-execution-creation": true,
            "job-resolution": true,
            "step-completion": true,
            "workflow-run-creation": true,
          },
          "reserved": false,
          "root": "run",
        },
        {
          "availability": "workflow-run-creation",
          "availableAt": {
            "job-execution-creation": true,
            "job-resolution": true,
            "step-completion": true,
            "workflow-run-creation": true,
          },
          "reserved": false,
          "root": "trigger",
        },
        {
          "availability": "workflow-run-creation",
          "availableAt": {
            "job-execution-creation": true,
            "job-resolution": true,
            "step-completion": true,
            "workflow-run-creation": true,
          },
          "reserved": false,
          "root": "event",
        },
        {
          "availability": "workflow-run-creation",
          "availableAt": {
            "job-execution-creation": true,
            "job-resolution": true,
            "step-completion": true,
            "workflow-run-creation": true,
          },
          "reserved": false,
          "root": "inputs",
        },
        {
          "availability": "workflow-run-creation",
          "availableAt": {
            "job-execution-creation": true,
            "job-resolution": true,
            "step-completion": true,
            "workflow-run-creation": true,
          },
          "reserved": false,
          "root": "job",
        },
        {
          "availability": "job-execution-creation",
          "availableAt": {
            "job-execution-creation": true,
            "job-resolution": true,
            "step-completion": true,
            "workflow-run-creation": false,
          },
          "reserved": false,
          "root": "executions",
        },
        {
          "availability": "job-execution-creation",
          "availableAt": {
            "job-execution-creation": true,
            "job-resolution": true,
            "step-completion": true,
            "workflow-run-creation": false,
          },
          "reserved": false,
          "root": "execution",
        },
        {
          "availability": "step-completion",
          "availableAt": {
            "job-execution-creation": false,
            "job-resolution": true,
            "step-completion": true,
            "workflow-run-creation": false,
          },
          "reserved": false,
          "root": "step",
        },
        {
          "availability": "step-completion",
          "availableAt": {
            "job-execution-creation": false,
            "job-resolution": true,
            "step-completion": true,
            "workflow-run-creation": false,
          },
          "reserved": true,
          "root": "steps",
        },
        {
          "availability": "job-resolution",
          "availableAt": {
            "job-execution-creation": false,
            "job-resolution": true,
            "step-completion": false,
            "workflow-run-creation": false,
          },
          "reserved": true,
          "root": "jobs",
        },
      ]
    `);
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

  it('type-checks step self-root gate expressions', () => {
    const gateExpression = createWorkflowExpression({
      source: 'step.exit_code == 0 && step.status == "succeeded"',
      check: {
        mode: 'typed',
        typeEnvironment: workflowContextDefinitions.step.typeEnvironment,
        expectedResultType: 'bool',
      },
    });

    expect(gateExpression.check).toBe('typed');
  });

  it('keeps executions event data dynamic after type conversion', () => {
    const eventDataExpression = createWorkflowExpression({
      source: 'executions.all(e, e.events.all(ev, ev.data.ok == true))',
      check: {
        mode: 'typed',
        typeEnvironment: workflowContextDefinitions.executions.typeEnvironment,
        expectedResultType: 'bool',
      },
    });

    expect(eventDataExpression.check).toBe('typed');
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

function availableAtReference(
  availability: WorkflowContextPhase,
): Readonly<Record<WorkflowContextPhase, boolean>> {
  const availabilityIndex = workflowContextPhases.indexOf(availability);
  return Object.fromEntries(
    workflowContextPhases.map((phase) => [
      phase,
      workflowContextPhases.indexOf(phase) >= availabilityIndex,
    ]),
  ) as Record<WorkflowContextPhase, boolean>;
}
