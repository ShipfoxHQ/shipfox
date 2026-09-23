import {Ajv} from 'ajv';
import {
  getWorkflowAuthoringContextResultJsonSchema,
  getWorkflowAuthoringContextResultSchema,
} from './authoring-context.js';

const reference = {
  thinking: 'low',
  intelligence_index: 70,
  cost_per_task_usd: 0.04,
  scale: 'aa-v1-swe-bench',
};
const model = {
  id: 'gpt-5',
  provider: 'openai',
  harness: 'pi',
  thinking: 'medium',
  supported_thinking: ['off', 'low', 'medium', 'high'],
  is_default: true,
  price: {input: 1, output: 4},
  references: [reference],
};
const result = {
  models: [model],
  default_model: model,
  attribution: 'Intelligence Index by Artificial Analysis',
  model_provider_configured: true,
  runners: ['linux'],
  secret_names: [],
  variable_names: [],
};

describe('workflow authoring context result schemas', () => {
  test('accepts measured values by supported thinking level in both schemas', () => {
    expect(getWorkflowAuthoringContextResultSchema.safeParse(result).success).toBe(true);
    expect(
      new Ajv({strict: true, strictRequired: false}).compile(
        getWorkflowAuthoringContextResultJsonSchema,
      )(result),
    ).toBe(true);
  });

  test('rejects measured values for unsupported thinking levels', () => {
    const unsupported = {
      ...result,
      models: [
        {
          ...model,
          supported_thinking: ['off', 'low'],
          references: [{...reference, thinking: 'high'}],
        },
      ],
    };

    expect(getWorkflowAuthoringContextResultSchema.safeParse(unsupported).success).toBe(false);
  });

  test('rejects duplicate measured and supported thinking levels', () => {
    const duplicateReferences = {
      ...result,
      models: [
        {
          ...model,
          references: [reference, {...reference, intelligence_index: 72}],
        },
      ],
    };
    const duplicateSupported = {
      ...result,
      models: [{...model, supported_thinking: ['off', 'low', 'low']}],
    };

    expect(getWorkflowAuthoringContextResultSchema.safeParse(duplicateReferences).success).toBe(
      false,
    );
    expect(getWorkflowAuthoringContextResultSchema.safeParse(duplicateSupported).success).toBe(
      false,
    );
    expect(
      new Ajv({strict: true, strictRequired: false}).compile(
        getWorkflowAuthoringContextResultJsonSchema,
      )(duplicateSupported),
    ).toBe(false);
  });

  test('requires attribution when at least one model is measured', () => {
    expect(
      getWorkflowAuthoringContextResultSchema.safeParse({...result, attribution: null}).success,
    ).toBe(false);
  });
});
