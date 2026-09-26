import {
  AGENT_ACCESS_WORKSPACE_MODELS_DEFAULT_PAGE_LIMIT,
  listWorkspaceModelsInputSchema,
  listWorkspaceModelsResultJsonSchema,
  listWorkspaceModelsResultSchema,
} from './workspace-models.js';

const model = {
  id: 'gpt-5',
  label: 'GPT 5',
  lab: 'OpenAI',
  provider: 'openai',
  harness: 'pi',
  supported_thinking: ['low', 'high'],
  price: {input: 1, output: 2},
  references: [
    {
      thinking: 'high',
      intelligence_index: 70,
      cost_per_task_usd: 0.1,
      scale: 'aa-v1',
    },
  ],
  is_default: true,
} as const;

describe('list_workspace_models schemas', () => {
  test('defaults to a page of 25 models and accepts every filter', () => {
    expect(
      listWorkspaceModelsInputSchema.parse({
        provider: 'openai',
        lab: 'OpenAI',
        query: 'gpt',
        scored_only: true,
      }),
    ).toEqual({
      provider: 'openai',
      lab: 'OpenAI',
      query: 'gpt',
      scored_only: true,
      limit: AGENT_ACCESS_WORKSPACE_MODELS_DEFAULT_PAGE_LIMIT,
    });
  });

  test('rejects unknown input fields and invalid page limits', () => {
    expect(listWorkspaceModelsInputSchema.safeParse({unexpected: true}).success).toBe(false);
    expect(listWorkspaceModelsInputSchema.safeParse({limit: 0}).success).toBe(false);
    expect(listWorkspaceModelsInputSchema.safeParse({limit: 101}).success).toBe(false);
  });

  test('requires the complete model row and strict result shape', () => {
    expect(
      listWorkspaceModelsResultSchema.safeParse({models: [model], next_cursor: null}).success,
    ).toBe(true);
    expect(
      listWorkspaceModelsResultSchema.safeParse({
        models: [{...model, label: undefined}],
        next_cursor: null,
      }).success,
    ).toBe(false);
    expect(
      listWorkspaceModelsResultSchema.safeParse({models: [model], next_cursor: null, extra: true})
        .success,
    ).toBe(false);
    expect(listWorkspaceModelsResultJsonSchema.properties.models.items.required).toEqual(
      expect.arrayContaining(['label', 'lab', 'references', 'is_default']),
    );
  });
});
