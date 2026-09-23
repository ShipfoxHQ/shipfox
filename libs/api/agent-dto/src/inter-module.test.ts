import {RUNNER_CAPABILITY_REQUIRED_ERROR_CODE} from './index.js';
import {agentInterModuleContract, agentSessionDescriptorSchema} from './inter-module.js';

const UUID = '00000000-0000-4000-8000-000000000001';
const ATTRIBUTION = 'Intelligence Index by Artificial Analysis';

function workspaceModel() {
  return {
    id: 'claude-opus-4-8',
    provider: 'anthropic',
    harness: 'claude' as const,
    thinking: 'high' as const,
    supported_thinking: ['low', 'medium', 'high', 'xhigh', 'max'] as const,
    is_default: true,
    price: null,
    references: [],
  };
}

function scoredWorkspaceModel() {
  return {
    ...workspaceModel(),
    price: {input: 5, output: 25},
    references: [
      {
        thinking: 'high' as const,
        intelligence_index: 80,
        cost_per_task_usd: 0.1,
        scale: 'aa-v1-swe-bench',
      },
    ],
  };
}

describe('agentInterModuleContract', () => {
  test('preserves the original validation catalog contract', () => {
    const input = agentInterModuleContract.methods.getValidationCatalog.input.parse({});
    const output = agentInterModuleContract.methods.getValidationCatalog.output.parse({
      version: 1,
      providers: [],
      harnesses: [],
    });

    expect(input).toEqual({});
    expect(output).toEqual({version: 1, providers: [], harnesses: []});
  });

  test('carries workspace context and the effective default harness in the V2 catalog', () => {
    const input = agentInterModuleContract.methods.getValidationCatalogV2.input.parse({
      workspaceId: UUID,
    });
    const output = agentInterModuleContract.methods.getValidationCatalogV2.output.parse({
      version: 2,
      default_harness_id: 'pi',
      providers: [],
      harnesses: [],
    });

    expect(input).toEqual({workspaceId: UUID});
    expect(output.default_harness_id).toBe('pi');
  });

  test('carries configured workspace models and the resolved default', () => {
    const input = agentInterModuleContract.methods.getWorkspaceModels.input.parse({
      workspaceId: UUID,
    });
    const output = agentInterModuleContract.methods.getWorkspaceModels.output.parse({
      models: [workspaceModel()],
      default_model: workspaceModel(),
      attribution: null,
    });

    expect(input).toEqual({workspaceId: UUID});
    expect(output).toEqual({
      models: [workspaceModel()],
      default_model: workspaceModel(),
      attribution: null,
    });
    expect(
      agentInterModuleContract.methods.getWorkspaceModels.output.parse({
        models: [],
        default_model: null,
        attribution: null,
      }),
    ).toEqual({models: [], default_model: null, attribution: null});
  });

  test('carries a scored workspace model through the output contract', () => {
    const model = scoredWorkspaceModel();
    const output = agentInterModuleContract.methods.getWorkspaceModels.output.parse({
      models: [model],
      default_model: model,
      attribution: ATTRIBUTION,
    });

    expect(output).toEqual({
      models: [model],
      default_model: model,
      attribution: ATTRIBUTION,
    });
  });

  test('rejects a scored workspace model without attribution', () => {
    const model = scoredWorkspaceModel();

    expect(() =>
      agentInterModuleContract.methods.getWorkspaceModels.output.parse({
        models: [model],
        default_model: model,
        attribution: null,
      }),
    ).toThrow('attribution is required when a model has references');
  });

  test('rejects attribution when no workspace model has a reference', () => {
    const model = workspaceModel();

    expect(() =>
      agentInterModuleContract.methods.getWorkspaceModels.output.parse({
        models: [model],
        default_model: model,
        attribution: ATTRIBUTION,
      }),
    ).toThrow('attribution must be null when no model has references');
  });

  test('preserves supported thinking levels and measured values at each level', () => {
    const model = {
      ...workspaceModel(),
      supported_thinking: ['low', 'medium', 'high'] as const,
      references: [
        {thinking: 'low' as const, intelligence_index: 70, cost_per_task_usd: 0.04, scale: 'aa-v1'},
        {thinking: 'high' as const, intelligence_index: 80, cost_per_task_usd: 0.1, scale: 'aa-v1'},
      ],
    };

    expect(
      agentInterModuleContract.methods.getWorkspaceModels.output.parse({
        models: [model],
        default_model: model,
        attribution: ATTRIBUTION,
      }).models[0],
    ).toEqual(model);
  });

  test('accepts distinct off and provider-default references for one model', () => {
    const model = {
      id: 'gpt-5.5-pro',
      provider: 'openai',
      harness: 'pi' as const,
      thinking: 'medium' as const,
      supported_thinking: ['off', 'default'] as const,
      is_default: true,
      price: null,
      references: [
        {thinking: 'off' as const, intelligence_index: 60, cost_per_task_usd: 0.04, scale: 'aa-v1'},
        {
          thinking: 'default' as const,
          intelligence_index: 80,
          cost_per_task_usd: 0.1,
          scale: 'aa-v1',
        },
      ],
    };

    expect(
      agentInterModuleContract.methods.getWorkspaceModels.output.parse({
        models: [model],
        default_model: model,
        attribution: ATTRIBUTION,
      }).models[0],
    ).toEqual(model);
  });

  test('rejects measured values for unsupported and duplicate thinking levels', () => {
    const model = scoredWorkspaceModel();
    const highReference = model.references[0];
    if (highReference === undefined) throw new Error('Expected a high reference fixture');

    expect(() =>
      agentInterModuleContract.methods.getWorkspaceModels.output.parse({
        models: [{...model, supported_thinking: ['low']}],
        default_model: null,
        attribution: ATTRIBUTION,
      }),
    ).toThrow('reference thinking must be supported by the model and harness');

    const defaultReference = {
      thinking: 'default' as const,
      intelligence_index: 80,
      cost_per_task_usd: 0.1,
      scale: 'aa-v1',
    };
    expect(() =>
      agentInterModuleContract.methods.getWorkspaceModels.output.parse({
        models: [
          {
            ...workspaceModel(),
            supported_thinking: ['low'] as const,
            references: [defaultReference],
          },
        ],
        default_model: null,
        attribution: ATTRIBUTION,
      }),
    ).toThrow('reference thinking must be supported by the model and harness');

    expect(() =>
      agentInterModuleContract.methods.getWorkspaceModels.output.parse({
        models: [
          {
            ...workspaceModel(),
            references: [highReference, {...highReference, intelligence_index: 81}],
          },
        ],
        default_model: null,
        attribution: ATTRIBUTION,
      }),
    ).toThrow('Each thinking level can have only one measured reference.');
  });

  test('rejects a workspace default model that is absent from models', () => {
    expect(() =>
      agentInterModuleContract.methods.getWorkspaceModels.output.parse({
        models: [],
        default_model: workspaceModel(),
        attribution: null,
      }),
    ).toThrow('default_model must be null or one of models');
  });

  test('rejects a default model without its matching is_default marker', () => {
    const defaultModel = workspaceModel();

    expect(() =>
      agentInterModuleContract.methods.getWorkspaceModels.output.parse({
        models: [{...defaultModel, is_default: false}],
        default_model: defaultModel,
        attribution: null,
      }),
    ).toThrow('default_model must match the only model marked as default');
  });

  test('rejects a marked model when default_model is null', () => {
    expect(() =>
      agentInterModuleContract.methods.getWorkspaceModels.output.parse({
        models: [workspaceModel()],
        default_model: null,
        attribution: null,
      }),
    ).toThrow('models must not mark a default when default_model is null');
  });

  test('rejects a marked non-default model', () => {
    const defaultModel = workspaceModel();

    expect(() =>
      agentInterModuleContract.methods.getWorkspaceModels.output.parse({
        models: [
          {...defaultModel, is_default: false},
          {...defaultModel, id: 'another-model'},
        ],
        default_model: defaultModel,
        attribution: null,
      }),
    ).toThrow('default_model must match the only model marked as default');
  });

  test('rejects multiple marked default models', () => {
    const defaultModel = workspaceModel();

    expect(() =>
      agentInterModuleContract.methods.getWorkspaceModels.output.parse({
        models: [defaultModel, {...defaultModel, id: 'another-model'}],
        default_model: defaultModel,
        attribution: null,
      }),
    ).toThrow('default_model must match the only model marked as default');
  });

  test('carries job identity in the runtime credentials context', () => {
    const input = {
      workspaceId: UUID,
      runId: '00000000-0000-4000-8000-000000000002',
      stepAttemptId: '00000000-0000-4000-8000-000000000003',
      jobIdentity: {
        projectId: '00000000-0000-4000-8000-000000000004',
        workflowRunAttemptId: '00000000-0000-4000-8000-000000000005',
        jobId: '00000000-0000-4000-8000-000000000006',
        jobExecutionId: '00000000-0000-4000-8000-000000000007',
        stepId: '00000000-0000-4000-8000-000000000008',
        attempt: 2,
      },
      harness: 'pi' as const,
      provider: 'shipfox' as const,
      model: 'managed-model',
      thinking: 'default' as const,
      renewableInference: true,
    };

    const parsed = agentInterModuleContract.methods.resolveRuntimeCredentials.input.parse(input);

    expect(parsed).toEqual(input);
  });

  test('requires the runner capability snapshot for runtime credentials', () => {
    expect(() =>
      agentInterModuleContract.methods.resolveRuntimeCredentials.input.parse({
        workspaceId: UUID,
        runId: '00000000-0000-4000-8000-000000000002',
        stepAttemptId: '00000000-0000-4000-8000-000000000003',
        harness: 'pi',
        provider: 'shipfox',
        model: 'managed-model',
        thinking: 'high',
      }),
    ).toThrow();
  });

  test('declares the runner capability failure for runtime credentials', () => {
    const error = agentInterModuleContract.methods.resolveRuntimeCredentials.errors[
      RUNNER_CAPABILITY_REQUIRED_ERROR_CODE
    ].parse({});

    expect(error).toEqual({});
  });

  test('rejects a runtime job identity without workflowRunAttemptId', () => {
    expect(() =>
      agentInterModuleContract.methods.resolveRuntimeCredentials.input.parse({
        workspaceId: UUID,
        runId: '00000000-0000-4000-8000-000000000002',
        stepAttemptId: '00000000-0000-4000-8000-000000000003',
        jobIdentity: {
          projectId: '00000000-0000-4000-8000-000000000004',
          jobId: '00000000-0000-4000-8000-000000000006',
          jobExecutionId: '00000000-0000-4000-8000-000000000007',
          stepId: '00000000-0000-4000-8000-000000000008',
          attempt: 2,
        },
        harness: 'pi',
        provider: 'shipfox',
        model: 'managed-model',
        thinking: 'high',
        renewableInference: true,
      }),
    ).toThrow();
  });

  test('accepts valid claimSession payloads in both modes', () => {
    const input = {
      workspaceId: UUID,
      projectId: '00000000-0000-4000-8000-000000000002',
      workflowRunAttemptId: '00000000-0000-4000-8000-000000000003',
      key: 'main',
      harness: 'pi' as const,
      stepAttemptId: '00000000-0000-4000-8000-000000000004',
      mode: 'resume' as const,
    };
    const parsed = agentInterModuleContract.methods.claimSession.input.parse(input);
    const forkParsed = agentInterModuleContract.methods.claimSession.input.parse({
      ...input,
      mode: 'fork',
    });

    expect(parsed).toEqual(input);
    expect(forkParsed.mode).toBe('fork');
  });

  test('accepts the claimSession output with a descriptor and the pinned harness', () => {
    const parsed = agentInterModuleContract.methods.claimSession.output.parse({
      descriptor: {id: UUID, key: 'main', mode: 'resume', segment: 0},
      harness: 'claude',
    });

    expect(parsed).toEqual({
      descriptor: {id: UUID, key: 'main', mode: 'resume', segment: 0},
      harness: 'claude',
    });
  });

  test('accepts a null descriptor for a fork of a session that does not exist', () => {
    const parsed = agentInterModuleContract.methods.claimSession.output.parse({
      descriptor: null,
      harness: 'pi',
    });

    expect(parsed).toEqual({descriptor: null, harness: 'pi'});
  });

  test('accepts valid carryOverSessions payloads and output', () => {
    const input = {
      fromWorkflowRunAttemptId: '00000000-0000-4000-8000-000000000005',
      toWorkflowRunAttemptId: '00000000-0000-4000-8000-000000000006',
    };
    const parsed = agentInterModuleContract.methods.carryOverSessions.input.parse(input);
    const output = agentInterModuleContract.methods.carryOverSessions.output.parse({
      sessions: [{id: UUID, key: 'main', segment: 0}],
    });

    expect(parsed).toEqual(input);
    expect(output).toEqual({sessions: [{id: UUID, key: 'main', segment: 0}]});
  });

  test.each([
    ['session-key-invalid', {}],
    ['session-held', {}],
    ['session-harness-mismatch', {}],
    ['session-lock-unavailable', {}],
  ] as const)('declares the %s claimSession failure shape', (code, details) => {
    const schema = agentInterModuleContract.methods.claimSession.errors[code];
    const parsed = schema.parse(details);

    expect(parsed).toEqual(details);
  });

  test('declares the carry-over-conflict failure shape', () => {
    const schema = agentInterModuleContract.methods.carryOverSessions.errors['carry-over-conflict'];
    const parsed = schema.parse({});

    expect(parsed).toEqual({});
  });

  test('validates the session descriptor schema', () => {
    const parsed = agentSessionDescriptorSchema.parse({
      id: UUID,
      key: 'main',
      mode: 'fork',
      segment: 3,
    });

    expect(parsed).toEqual({id: UUID, key: 'main', mode: 'fork', segment: 3});
  });

  test('rejects a descriptor with a negative segment', () => {
    expect(() =>
      agentSessionDescriptorSchema.parse({id: UUID, key: 'main', mode: 'fork', segment: -1}),
    ).toThrow();
  });
});
