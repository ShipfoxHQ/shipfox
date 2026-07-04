import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
import {InvalidWorkflowExpressionError} from '../expression/errors.js';
import {
  type AvailabilitySite,
  availabilitySites,
  type FillTarget,
  getWorkflowContextTypeEnvironment,
  getWorkflowInterpolationFieldFailurePolicy,
  resolveContextRootAvailability,
  resolveContextRootHost,
  rootsAvailableAt,
  runnerFillTarget,
  unavailableRootsAt,
  type WorkflowContextName,
  type WorkflowContextTrustTier,
  type WorkflowInterpolationField,
  workflowContextAvailabilityReference,
  workflowContextDefinitions,
  workflowContextHosts,
  workflowContextNames,
  workflowContextReservedRoots,
  workflowContextSensitivities,
  workflowContextTrustTiers,
  workflowFieldFailurePolicies,
  workflowInterpolationFieldAcceptsContext,
  workflowInterpolationFieldAcceptsHost,
  workflowInterpolationFieldAcceptsTrustTier,
  workflowInterpolationFieldPolicies,
  workflowInterpolationFields,
  workflowPredicateFieldFailurePolicy,
  workflowPredicateFields,
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
      'steps',
      'step',
      'vars',
      'secrets',
    ]);
  });

  it('keeps future roots reserved out of the referenceable registry', () => {
    expect(workflowContextReservedRoots).toEqual({
      jobs: {host: 'server', availability: 'job-resolution'},
      matrix: {host: 'server', availability: 'job-activation'},
      runner: {host: 'runner'},
    });
    expect(workflowContextNames).toContain('step');
    expect(workflowContextNames).toContain('steps');
    expect(workflowContextNames).not.toContain('jobs');
    expect(workflowContextNames).not.toContain('matrix');
    expect(workflowContextNames).not.toContain('runner');
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
      'steps',
      'step',
      'vars',
      'secrets',
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
      availability: 'step-report',
      trustTier: 'trusted',
      shape: 'known',
      checkMode: 'typed',
    });
    expect(workflowContextDefinitions.steps).toMatchObject({
      availability: 'step-dispatch',
      trustTier: 'trusted',
      shape: 'open',
      checkMode: 'syntax',
    });
    expect(workflowContextDefinitions.event).toMatchObject({
      shape: 'open',
      checkMode: 'syntax',
    });
    expect(workflowContextDefinitions.inputs).toMatchObject({
      shape: 'open',
      checkMode: 'syntax',
    });
    expect(workflowContextDefinitions.vars).toMatchObject({
      availability: 'run-creation',
      trustTier: 'trusted',
      sensitivity: 'persistable',
      host: 'server',
      shape: 'open',
      checkMode: 'syntax',
      literalKeyOnly: true,
    });
    expect(workflowContextDefinitions.secrets).toMatchObject({
      trustTier: 'trusted',
      sensitivity: 'ephemeral',
      host: 'runner',
      shape: 'open',
      checkMode: 'syntax',
      literalKeyOnly: true,
    });
  });

  it('declares every implemented context with all registry dimensions', () => {
    for (const root of workflowContextNames) {
      expect(workflowContextDefinitions[root]).toMatchObject({
        trustTier: expect.any(String),
        sensitivity: expect.any(String),
        host: expect.any(String),
        shape: expect.any(String),
        checkMode: expect.any(String),
      });
      const availability = resolveContextRootAvailability(root);
      if (workflowContextDefinitions[root].host === 'server') {
        expect(availabilitySites).toContain(availability);
      } else {
        expect(availability).toBeUndefined();
      }
      expect(workflowContextTrustTiers).toContain(workflowContextDefinitions[root].trustTier);
      expect(workflowContextSensitivities).toContain(workflowContextDefinitions[root].sensitivity);
      expect(workflowContextHosts).toContain(workflowContextDefinitions[root].host);
    }
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
    expect(getWorkflowContextTypeEnvironment('steps')).toBeUndefined();
    expect(getWorkflowContextTypeEnvironment('vars')).toBeUndefined();
    expect(getWorkflowContextTypeEnvironment('secrets')).toBeUndefined();
  });

  it('returns the roots available at each availability site', () => {
    expect(rootsAvailableAt('ingest')).toEqual([]);
    expect(rootsAvailableAt('run-creation')).toEqual([
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'vars',
    ]);
    expect(rootsAvailableAt('execution-creation')).toEqual([
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
      'vars',
    ]);
    expect(rootsAvailableAt('job-activation')).toEqual([
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
      'vars',
    ]);
    expect(rootsAvailableAt('step-dispatch')).toEqual([
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
      'steps',
      'vars',
    ]);
    expect(rootsAvailableAt('step-report')).toEqual([
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
      'steps',
      'step',
      'vars',
    ]);
    expect(rootsAvailableAt('execution-resolution')).toEqual([
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
      'steps',
      'step',
      'vars',
    ]);
    expect(rootsAvailableAt('job-resolution')).toEqual([
      'run',
      'trigger',
      'event',
      'inputs',
      'job',
      'executions',
      'execution',
      'steps',
      'step',
      'vars',
    ]);
  });

  it('returns unavailable known roots at an availability site', () => {
    expect(unavailableRootsAt(['run', 'execution', 'executions', 'step'], 'run-creation')).toEqual([
      'execution',
      'executions',
      'step',
    ]);
    expect(
      unavailableRootsAt(['run', 'execution', 'executions', 'step'], 'execution-creation'),
    ).toEqual(['step']);
    expect(unavailableRootsAt(['run', 'execution', 'executions', 'step'], 'step-report')).toEqual(
      [],
    );
  });

  it.each(
    availabilitySites,
  )('returns no unavailable roots when all roots are available at %s', (site) => {
    const roots = rootsAvailableAt(site);

    const unavailableRoots = unavailableRootsAt(roots, site);

    expect(unavailableRoots).toEqual([]);
  });

  it.each(
    availabilitySites.filter(
      (site) => availabilitySites.indexOf(site) < availabilitySites.indexOf('step-report'),
    ),
  )('reports step as unavailable before step-report at %s', (site) => {
    const unavailableRoots = unavailableRootsAt(['step'], site);

    expect(unavailableRoots).toEqual(['step']);
  });

  it('never returns runner-host roots at a server availability site', () => {
    for (const site of availabilitySites) {
      const availableRoots = rootsAvailableAt(site);
      for (const root of availableRoots) {
        expect(workflowContextDefinitions[root].host).toBe('server');
      }
      expect(availableRoots).not.toContain('runner');
      expect(availableRoots).not.toContain('secrets');
    }
  });

  it('keeps workflow context availability monotonic across sites', () => {
    const siteIndexes = new Map<AvailabilitySite, number>(
      availabilitySites.map((site, index) => [site, index]),
    );

    const sitePairs: readonly [AvailabilitySite, AvailabilitySite][] = [
      ['ingest', 'run-creation'],
      ['run-creation', 'execution-creation'],
      ['execution-creation', 'job-activation'],
      ['job-activation', 'step-dispatch'],
      ['step-dispatch', 'step-report'],
      ['step-report', 'execution-resolution'],
      ['execution-resolution', 'job-resolution'],
    ];

    for (const [previousSite, currentSite] of sitePairs) {
      const previous = new Set(rootsAvailableAt(previousSite));
      const current = new Set(rootsAvailableAt(currentSite));

      for (const root of previous) {
        expect(current.has(root)).toBe(true);
      }
    }

    for (const root of workflowContextNames) {
      const availability = resolveContextRootAvailability(root);
      if (availability === undefined) continue;

      const available = rootsAvailableAt(availability);
      expect(available).toContain(root);
      expect(siteIndexes.get(availability)).toBeDefined();
    }
  });

  it('keeps runner fill as a non-site fill target', () => {
    const target: FillTarget = runnerFillTarget;

    expect(target).toBe('runner-fill');
    expect(availabilitySites).not.toContain(target as AvailabilitySite);
  });

  it('generates an availability reference from the registry and reserved roots', () => {
    const expected = [
      ...workflowContextNames.map((root) => {
        const availability = resolveContextRootAvailability(root);
        return availability === undefined
          ? {
              root,
              reserved: false,
              availableAt: noServerAvailabilityReference(),
            }
          : {
              root,
              availability,
              reserved: false,
              availableAt: availableAtReference(availability),
            };
      }),
      ...Object.entries(workflowContextReservedRoots).map(([root, definition]) =>
        definition.host === 'runner'
          ? {
              root,
              reserved: true,
              availableAt: noServerAvailabilityReference(),
            }
          : {
              root,
              availability: definition.availability,
              reserved: true,
              availableAt: availableAtReference(definition.availability),
            },
      ),
    ];

    expect(workflowContextAvailabilityReference()).toEqual(expected);
  });

  it('resolves root host and availability across implemented and reserved roots', () => {
    expect(resolveContextRootHost('run')).toBe('server');
    expect(resolveContextRootAvailability('run')).toBe('run-creation');
    expect(resolveContextRootHost('steps')).toBe('server');
    expect(resolveContextRootAvailability('steps')).toBe('step-dispatch');
    expect(resolveContextRootHost('vars')).toBe('server');
    expect(resolveContextRootAvailability('vars')).toBe('run-creation');
    expect(resolveContextRootHost('secrets')).toBe('runner');
    expect(resolveContextRootAvailability('secrets')).toBeUndefined();
    expect(resolveContextRootHost('runner')).toBe('runner');
    expect(resolveContextRootAvailability('runner')).toBeUndefined();
    expect(resolveContextRootHost('unknown')).toBeUndefined();
    expect(resolveContextRootAvailability('unknown')).toBeUndefined();
  });

  describe('workflow field failure policies', () => {
    it('declares the supported failure-policy classes', () => {
      expect(workflowFieldFailurePolicies).toEqual(['fail', 'degrade', 'fail-closed']);
    });

    it('maps interpolation fields to fail or degrade policies', () => {
      expect(getWorkflowInterpolationFieldFailurePolicy('run')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('env.value')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('agent.prompt')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('agent.model')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('agent.provider')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('agent.thinking')).toBe('fail');
      expect(getWorkflowInterpolationFieldFailurePolicy('job.name')).toBe('degrade');
      expect(getWorkflowInterpolationFieldFailurePolicy('step.name')).toBe('degrade');
      expect(
        workflowInterpolationFields.map(
          (field) => workflowInterpolationFieldPolicies[field].failurePolicy,
        ),
      ).not.toContain('fail-closed');
    });

    it('declares predicate fields as fail-closed', () => {
      expect(workflowPredicateFields).toEqual(['step.success_if', 'job.success']);
      expect(workflowPredicateFieldFailurePolicy).toBe('fail-closed');
    });
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

  it.each([
    ['run', ['server', 'runner']],
    ['env.value', ['server', 'runner']],
    ['agent.prompt', ['server']],
    ['agent.model', ['server']],
    ['agent.provider', ['server']],
    ['agent.thinking', ['server']],
    ['job.name', ['server']],
    ['step.name', ['server']],
  ] satisfies readonly [
    WorkflowInterpolationField,
    readonly string[],
  ][])('allows %s interpolation from the expected hosts', (field, hosts) => {
    expect(workflowInterpolationFieldPolicies[field].acceptedHosts).toEqual(hosts);
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

  it('rejects runner-host contexts from server-only fields', () => {
    expect(workflowInterpolationFieldAcceptsHost('run', 'runner')).toBe(true);
    expect(workflowInterpolationFieldAcceptsHost('env.value', 'runner')).toBe(true);
    expect(workflowInterpolationFieldAcceptsHost('agent.prompt', 'runner')).toBe(false);
    expect(workflowInterpolationFieldAcceptsHost('agent.model', 'runner')).toBe(false);
    expect(workflowInterpolationFieldAcceptsHost('agent.provider', 'runner')).toBe(false);
    expect(workflowInterpolationFieldAcceptsHost('job.name', 'runner')).toBe(false);
    expect(workflowInterpolationFieldAcceptsHost('step.name', 'runner')).toBe(false);
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
      expect(policy.acceptedHosts.length).toBeGreaterThan(0);
      for (const host of policy.acceptedHosts) {
        expect(workflowContextHosts).toContain(host);
      }
    }
  });
});

function availableAtReference(
  availability: AvailabilitySite,
): Readonly<Record<AvailabilitySite, boolean>> {
  const availabilityIndex = availabilitySites.indexOf(availability);
  return Object.fromEntries(
    availabilitySites.map((site) => [site, availabilitySites.indexOf(site) >= availabilityIndex]),
  ) as Record<AvailabilitySite, boolean>;
}

function noServerAvailabilityReference(): Readonly<Record<AvailabilitySite, boolean>> {
  return Object.fromEntries(availabilitySites.map((site) => [site, false])) as Record<
    AvailabilitySite,
    boolean
  >;
}
