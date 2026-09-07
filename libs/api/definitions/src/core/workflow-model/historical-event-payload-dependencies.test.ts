import {createWorkflowExpression} from '@shipfox/expression';
import type {WorkflowDocument} from '@shipfox/workflow-document';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {
  auditStoredWorkflowDefinitionModels,
  auditWorkflowModelHistoricalEventPayloadDependencies,
  historicalEventPayloadDependencyIssues,
} from './historical-event-payload-dependencies.js';
import {normalizeWorkflowDocument} from './normalize-workflow-document.js';

function interpolation(source: string): string {
  return '$'.concat('{{ ', source, ' }}');
}

function normalize(document: WorkflowDocument) {
  const diagnostics = [] as Parameters<typeof normalizeWorkflowDocument>[1]['diagnostics'];
  const model = normalizeWorkflowDocument(document, {
    agentValidationCatalog,
    defaultRunnerLabels: ['ubuntu-latest'],
    diagnostics,
  });
  return {model, diagnostics: diagnostics ?? []};
}

describe('historical event-payload definition analysis', () => {
  it('warns without invalidating a definition and keeps a stable authored path', () => {
    const {model, diagnostics} = normalize({
      name: 'historical payload',
      jobs: {
        review: {
          success: 'executions[0].events[0].data.action == "opened"',
          listening: {
            on: [{source: 'github', event: 'push'}],
            timeout: '1h',
          },
          steps: [{run: 'echo ok'}],
        },
      },
    });

    expect(model.jobs[0]?.success).toBe('executions[0].events[0].data.action == "opened"');
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'historical-event-payload-dependency',
        path: ['jobs', 'review', 'success'],
        severity: 'warning',
        details: expect.objectContaining({
          classification: 'payload',
          contextPath: 'executions[0].events[0].data.action',
        }),
      }),
    );
  });

  it('audits normalized checkout target templates', () => {
    const source = 'executions[0].events[0].data.repository';
    const {diagnostics} = normalize({
      name: 'checkout history',
      jobs: {
        build: {
          steps: [
            {
              checkout: {
                repository: interpolation(source),
                ref: interpolation(source),
              },
            },
          ],
        },
      },
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'historical-event-payload-dependency',
          path: ['jobs', 'build', 'steps', 0, 'checkout', 'repository'],
          details: expect.objectContaining({classification: 'payload', expression: source}),
        }),
        expect.objectContaining({
          code: 'historical-event-payload-dependency',
          path: ['jobs', 'build', 'steps', 0, 'checkout', 'ref'],
          details: expect.objectContaining({classification: 'payload', expression: source}),
        }),
      ]),
    );
  });

  it('warns for whole-element filter and map template results', () => {
    const filterSource = 'executions.filter(e, e.status == "succeeded")';
    const mapSource = 'executions.map(e, e)';
    const {model} = normalize({
      name: 'historical template results',
      jobs: {
        inspect: {
          steps: [
            {
              tool: 'get_issue',
              connection: 'linear-main',
              with: {history: interpolation(mapSource)},
            },
          ],
        },
      },
    });
    const plannedModel = {
      ...model,
      runName: [
        {
          kind: 'deferred' as const,
          expression: createWorkflowExpression({
            source: filterSource,
            check: {mode: 'syntax'},
          }),
          roots: ['executions'],
          fillTarget: 'run-creation' as const,
        },
      ],
    };

    const warnings = historicalEventPayloadDependencyIssues(plannedModel).filter(
      (diagnostic) => diagnostic.code === 'historical-event-payload-dependency',
    );
    expect(warnings).toHaveLength(2);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['run_name'],
          details: expect.objectContaining({classification: 'unknown', expression: filterSource}),
        }),
        expect.objectContaining({
          path: ['jobs', 'inspect', 'steps', 0, 'with', 'history'],
          details: expect.objectContaining({classification: 'unknown', expression: mapSource}),
        }),
      ]),
    );
    expect(auditWorkflowModelHistoricalEventPayloadDependencies(plannedModel).classification).toBe(
      'unknown',
    );
  });

  it('bounds dynamic warning messages while retaining the full expression details', () => {
    const source = `executions[vars.index].events[0].data.action${' '.repeat(2200)}== "opened"`;
    const {model, diagnostics} = normalize({
      name: 'long historical expression',
      jobs: {
        review: {
          success: source,
          steps: [{run: 'echo ok'}],
        },
      },
    });

    const warning = diagnostics.find(
      (diagnostic) => diagnostic.code === 'historical-event-payload-dependency',
    );
    expect(warning).toMatchObject({
      details: expect.objectContaining({classification: 'unknown', expression: source}),
    });
    expect(warning?.message).toContain('…');
    expect(warning?.message).not.toContain(source);
    expect(warning?.message.length).toBeLessThan(2048);
    expect(historicalEventPayloadDependencyIssues(model)[0]?.details).toMatchObject({
      expression: source,
    });
  });

  it('keeps warnings for distinct dotted authored paths with the same expression', () => {
    const source = 'executions[0].events[0].data.action';
    const {model} = normalize({
      name: 'dotted historical paths',
      jobs: {
        'a.outputs': {
          success: `${source} == "opened"`,
          steps: [{run: 'echo first'}],
        },
        a: {
          outputs: {success: interpolation(source)},
          steps: [{run: 'echo second'}],
        },
      },
    });

    const warnings = historicalEventPayloadDependencyIssues(model).filter(
      (diagnostic) => diagnostic.code === 'historical-event-payload-dependency',
    );
    expect(warnings).toHaveLength(2);
    expect(warnings.map((warning) => warning.path)).toEqual(
      expect.arrayContaining([
        ['jobs', 'a.outputs', 'success'],
        ['jobs', 'a', 'outputs', 'success'],
      ]),
    );
  });

  it('warns for dynamic and comprehension-based references in templates', () => {
    const {diagnostics} = normalize({
      name: 'historical templates',
      jobs: {
        review: {
          success: 'executions[vars.index].events[0].data.name == "ok"',
          listening: {
            on: [{source: 'github', event: 'push'}],
            timeout: '1h',
          },
          steps: [{run: 'echo ok'}],
        },
        audit: {
          success: 'executions.map(e, e.events.map(event, event.data.name)).size() > 0',
          listening: {
            on: [{source: 'github', event: 'push'}],
            timeout: '1h',
          },
          steps: [{run: 'echo ok'}],
        },
      },
    });

    const payloadWarnings = diagnostics.filter(
      (diagnostic) => diagnostic.code === 'historical-event-payload-dependency',
    );
    expect(payloadWarnings).toHaveLength(2);
    expect(payloadWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['jobs', 'review', 'success'],
          details: expect.objectContaining({classification: 'unknown'}),
        }),
        expect.objectContaining({
          path: ['jobs', 'audit', 'success'],
          details: expect.objectContaining({classification: 'payload'}),
        }),
      ]),
    );
  });

  it('warns when authored batch size can create byte partitions', () => {
    const {model, diagnostics} = normalize({
      name: 'large batch',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'push'}],
            timeout: '1h',
            batch: {max_size: 101},
          },
          steps: [{run: 'echo ok'}],
        },
      },
    });

    expect(model.jobs[0]?.listening?.batch?.maxSize).toBe(101);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'listener-batch-max-size-may-partition',
        path: ['jobs', 'review', 'listening', 'batch', 'max_size'],
        severity: 'warning',
        details: expect.objectContaining({effectiveMaxSize: 100}),
      }),
    );
  });

  it('audits deferred template plans with stable authored paths', () => {
    const {model} = normalize({
      name: 'planned history',
      jobs: {
        review: {
          listening: {
            on: [{source: 'github', event: 'push'}],
            timeout: '1h',
          },
          steps: [{run: 'echo ok'}],
        },
      },
    });
    const plannedModel = {
      ...model,
      runName: [
        {
          kind: 'deferred' as const,
          expression: createWorkflowExpression({
            source: 'executions[0].events[0].data.name',
            check: {mode: 'syntax'},
          }),
          roots: ['executions'],
          fillTarget: 'run-creation' as const,
        },
      ],
    };

    const audit = auditWorkflowModelHistoricalEventPayloadDependencies(plannedModel);
    expect(audit.classification).toBe('payload');
    expect(audit.dependencies).toEqual(
      expect.arrayContaining([expect.objectContaining({path: ['run_name']})]),
    );
  });

  it('keeps current execution events and metadata out of the dependency audit', () => {
    const {model} = normalize({
      name: 'safe history',
      jobs: {
        review: {
          success:
            'executions[0].events[0].source == "github" && executions[0].status == "succeeded"',
          listening: {
            on: [{source: 'github', event: 'push'}],
            timeout: '1h',
          },
          steps: [{run: 'echo ok'}],
        },
      },
    });

    expect(auditWorkflowModelHistoricalEventPayloadDependencies(model)).toMatchObject({
      classification: 'safe',
      dependencies: [],
    });
    expect(auditStoredWorkflowDefinitionModels([model])).toEqual({
      totalDefinitions: 1,
      safeDefinitions: 1,
      payloadDefinitions: 0,
      unknownDefinitions: 0,
    });
  });

  it('keeps unknown access in an explicit audit bucket', () => {
    const {model} = normalize({
      name: 'unknown history',
      jobs: {
        review: {
          success: 'executions[vars.index].events[0].data.action == "opened"',
          listening: {
            on: [{source: 'github', event: 'push'}],
            timeout: '1h',
          },
          steps: [{run: 'echo ok'}],
        },
      },
    });

    expect(auditWorkflowModelHistoricalEventPayloadDependencies(model).classification).toBe(
      'unknown',
    );
    expect(auditStoredWorkflowDefinitionModels([model])).toMatchObject({
      totalDefinitions: 1,
      safeDefinitions: 0,
      payloadDefinitions: 0,
      unknownDefinitions: 1,
    });
    expect(historicalEventPayloadDependencyIssues(model)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'historical-event-payload-dependency',
          severity: 'warning',
        }),
      ]),
    );
  });
});
