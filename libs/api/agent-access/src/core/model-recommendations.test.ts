import type {ModelChoiceDto, ModelRecommendationGroupDto} from '@shipfox/api-agent-access-dto';
import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {extractModelAnchors, type WorkflowTemplateModel} from '@shipfox/workflow-templates';
import {
  applyModelChoice,
  createTestAgentClient,
  markedStepConfigs,
  scoredModel,
  TEST_ATTRIBUTION,
  workspaceModel,
} from '#test/fixtures/agent-models.js';
import {
  buildModelRecommendations,
  createModelBindingResolver,
  MODEL_RECOMMENDATION_COST_NOTE,
} from './model-recommendations.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const workflowYaml = [
  'name: fixture',
  'jobs:',
  '  work:',
  '    steps:',
  '      - key: fix',
  '        model: luna # model:fix',
  '        thinking: max',
  '        prompt: Fix the issue.',
  '      - key: follow_up',
  '        model: luna # model:fix',
  '        thinking: max',
  '        prompt: Follow up.',
  '      - key: review',
  '        model: luna # model:review',
  '        thinking: max',
  '        prompt: Review the fix.',
  '      - key: reply',
  '        model: sol # model:reply',
  '        thinking: low',
  '        prompt: Post the replies.',
].join('\n');
const placeholders: Record<string, WorkflowTemplateModel> = {
  fix: {note: 'Implements the ticket.'},
  review: {note: 'Reviews the fix.'},
  reply: {},
};

const luna = scoredModel({
  id: 'luna',
  provider: 'shipfox',
  lab: 'OpenAI',
  thinking: 'max',
  index: 37.26,
  cost: 0.07,
});
const sol = scoredModel({
  id: 'sol',
  provider: 'shipfox',
  lab: 'OpenAI',
  thinking: 'high',
  index: 42.82,
  cost: 0.38,
});
const flash = scoredModel({
  id: 'flash',
  provider: 'shipfox',
  lab: 'Google',
  thinking: 'medium',
  index: 39.77,
  cost: 0.98,
});
const sonnet = scoredModel({
  id: 'sonnet',
  provider: 'shipfox',
  lab: 'Anthropic',
  thinking: 'max',
  index: 38.16,
  cost: 5.35,
});
const pro = scoredModel({
  id: 'pro',
  provider: 'shipfox',
  lab: 'DeepSeek',
  thinking: 'max',
  index: 36,
  cost: 1.27,
});
const managedCatalog = [luna, sol, flash, sonnet, pro];

describe('model recommendations', () => {
  test('recommends the tested model and labelled alternatives when it resolves as written', async () => {
    const agent = createTestAgentClient({
      models: managedCatalog,
      runtimeProvider: 'shipfox',
      managedProviderId: 'shipfox',
      defaultModel: {id: 'pro', provider: 'shipfox'},
    });

    const groups = await recommendations(agent);

    expect(groups).toEqual([
      {
        placeholders: ['fix', 'review'],
        notes: {fix: 'Implements the ticket.', review: 'Reviews the fix.'},
        mode: 'recommended',
        choices: [
          expect.objectContaining({
            model: 'luna',
            label: 'LUNA',
            lab: 'OpenAI',
            provider: 'shipfox',
            harness: 'pi',
            thinking: 'max',
            provider_required: false,
            is_anchor: true,
            is_default: false,
            intelligence_index: 37.26,
            cost_per_task_usd: 0.07,
            tradeoff: null,
          }),
          expect.objectContaining({
            model: 'sol',
            thinking: 'high',
            provider_required: false,
            is_anchor: false,
            tradeoff: {
              intelligence: 'slightly_smarter',
              cost: 'much_more_expensive',
              label: 'Slightly smarter, much more expensive',
            },
          }),
          expect.objectContaining({model: 'flash', lab: 'Google'}),
          expect.objectContaining({model: 'sonnet', lab: 'Anthropic'}),
          expect.objectContaining({model: 'pro', lab: 'DeepSeek'}),
        ],
        scale: 'coding-v1',
        attribution: TEST_ATTRIBUTION,
        cost_note: MODEL_RECOMMENDATION_COST_NOTE,
      },
      {
        placeholders: ['reply'],
        notes: {},
        mode: 'template_default',
        choices: [
          expect.objectContaining({
            model: 'sol',
            thinking: 'low',
            provider_required: false,
            is_anchor: true,
            intelligence_index: null,
            cost_per_task_usd: null,
            tradeoff: null,
          }),
        ],
      },
    ]);
    for (const choice of groupFor(groups, 'fix').choices) {
      await expectChoiceResolves({agent, placeholder: 'fix', choice});
    }
  });

  test('binds the managed provider when the step as written resolves elsewhere', async () => {
    const agent = createTestAgentClient({
      models: [
        ...managedCatalog,
        workspaceModel({id: 'sol', provider: 'openai', label: 'GPT Sol'}),
      ],
      runtimeProvider: 'openai',
      managedProviderId: 'shipfox',
    });

    const fix = groupFor(await recommendations(agent), 'fix');

    expect(fix.mode).toBe('recommended');
    expect(
      fix.choices.map(({model, provider, provider_required}) => [
        model,
        provider,
        provider_required,
      ]),
    ).toEqual([
      ['luna', 'shipfox', true],
      ['sol', 'openai', false],
      ['flash', 'shipfox', true],
      ['sonnet', 'shipfox', true],
      ['pro', 'shipfox', true],
    ]);
    expect(fix.choices[1]).toMatchObject({label: 'GPT Sol', lab: 'OpenAI'});
    for (const choice of fix.choices) {
      await expectChoiceResolves({agent, placeholder: 'fix', choice});
    }
  });

  test('binds the only provider that lists the tested model', async () => {
    const agent = createTestAgentClient({
      models: [
        workspaceModel({id: 'claude', provider: 'anthropic'}),
        workspaceModel({id: 'luna', provider: 'openrouter', label: 'Luna'}),
      ],
      runtimeProvider: 'anthropic',
      defaultModel: {id: 'claude', provider: 'anthropic'},
    });

    const fix = groupFor(await recommendations(agent), 'fix');

    expect(fix).toMatchObject({
      mode: 'template_default',
      choices: [{model: 'luna', provider: 'openrouter', provider_required: true, is_anchor: true}],
    });
    await expectChoiceResolves({agent, placeholder: 'fix', choice: onlyChoice(fix)});
  });

  test('treats a model under two bring-your-own-key providers as unavailable', async () => {
    const agent = createTestAgentClient({
      models: [
        workspaceModel({id: 'claude', provider: 'anthropic', thinking: 'high'}),
        workspaceModel({id: 'luna', provider: 'openrouter'}),
        workspaceModel({id: 'luna', provider: 'vercel-ai-gateway'}),
      ],
      runtimeProvider: 'anthropic',
      defaultModel: {id: 'claude', provider: 'anthropic'},
    });

    const fix = groupFor(await recommendations(agent), 'fix');

    expect(fix).toEqual({
      placeholders: ['fix', 'review'],
      notes: {fix: 'Implements the ticket.', review: 'Reviews the fix.'},
      mode: 'workspace_default',
      choices: [
        expect.objectContaining({
          model: 'claude',
          provider: 'anthropic',
          thinking: 'high',
          provider_required: false,
          is_anchor: false,
          is_default: true,
        }),
      ],
    });
    await expectChoiceResolves({agent, placeholder: 'fix', choice: onlyChoice(fix)});
  });

  test('keeps the runtime provider when it lists a model that other providers also list', async () => {
    const agent = createTestAgentClient({
      models: [
        workspaceModel({id: 'luna', provider: 'openrouter'}),
        workspaceModel({id: 'luna', provider: 'vercel-ai-gateway'}),
      ],
      runtimeProvider: 'vercel-ai-gateway',
    });

    const fix = groupFor(await recommendations(agent), 'fix');

    expect(fix.choices).toMatchObject([{provider: 'vercel-ai-gateway', provider_required: false}]);
  });

  test('keeps an available but unscored tested model as the template default', async () => {
    const agent = createTestAgentClient({
      models: [scoredModel({...lunaParams(), thinking: 'high'}), sol, flash],
      runtimeProvider: 'shipfox',
      managedProviderId: 'shipfox',
      defaultModel: {id: 'sol', provider: 'shipfox'},
    });

    const fix = groupFor(await recommendations(agent), 'fix');

    expect(fix).toMatchObject({
      mode: 'template_default',
      choices: [{model: 'luna', thinking: 'max', is_anchor: true, intelligence_index: null}],
    });
    expect(fix).not.toHaveProperty('scale');
  });

  test('asks the user to choose when neither the tested model nor a default is available', async () => {
    const agent = createTestAgentClient({
      models: [workspaceModel({id: 'claude', provider: 'anthropic'})],
      runtimeProvider: 'anthropic',
      defaultModel: null,
    });

    const groups = await recommendations(agent);

    expect(groups).toEqual([
      {
        placeholders: ['fix', 'review'],
        notes: {fix: 'Implements the ticket.', review: 'Reviews the fix.'},
        mode: 'choose',
        choices: [],
      },
      {placeholders: ['reply'], notes: {}, mode: 'choose', choices: []},
    ]);
  });

  test('always writes the provider of a catalog pick', async () => {
    const agent = createTestAgentClient({
      models: [...managedCatalog, workspaceModel({id: 'sol', provider: 'openai'})],
      runtimeProvider: 'openai',
      managedProviderId: 'shipfox',
    });
    const pick = {model: 'sol', provider: 'shipfox', thinking: 'high' as const};

    await expectChoiceResolves({
      agent,
      placeholder: 'fix',
      choice: {...pick, harness: 'pi', provider_required: false},
      writeProvider: true,
    });
  });
});

async function recommendations(agent: AgentInterModuleClient) {
  const workspaceModels = await agent.getWorkspaceModels({workspaceId});
  return await buildModelRecommendations({
    placeholders,
    anchors: extractModelAnchors(workflowYaml),
    workspaceModels,
    resolveBinding: createModelBindingResolver({agent, workspaceId, workspaceModels}),
  });
}

function groupFor(groups: readonly ModelRecommendationGroupDto[], placeholder: string) {
  const group = groups.find(({placeholders: names}) => names.includes(placeholder));
  if (group === undefined) throw new Error(`Missing group for ${placeholder}`);
  return group;
}

function onlyChoice(group: ModelRecommendationGroupDto) {
  const choice = group.choices[0];
  if (choice === undefined || group.choices.length !== 1) throw new Error('Expected one choice');
  return choice;
}

function lunaParams() {
  return {id: 'luna', provider: 'shipfox', lab: 'OpenAI', index: 37.26, cost: 0.07};
}

/** Applies the choice to the workflow and checks every marked step resolves to that binding. */
async function expectChoiceResolves(params: {
  agent: AgentInterModuleClient;
  placeholder: string;
  choice: Pick<ModelChoiceDto, 'model' | 'provider' | 'harness' | 'thinking' | 'provider_required'>;
  writeProvider?: boolean;
}) {
  const {choice} = params;
  const yaml = applyModelChoice(workflowYaml, params.placeholder, choice, {
    writeProvider: params.writeProvider,
  });
  const steps = markedStepConfigs(yaml, params.placeholder);

  expect(steps).toHaveLength(markedStepConfigs(workflowYaml, params.placeholder).length);
  for (const step of steps) {
    const resolved = await params.agent.resolveAgentConfig({workspaceId, config: step});
    expect(resolved).toEqual({
      provider: choice.provider,
      harness: choice.harness,
      model: choice.model,
      thinking: choice.thinking,
    });
  }
}
