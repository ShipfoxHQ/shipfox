import {Ajv} from 'ajv';
import * as addFormatsModule from 'ajv-formats';
import {
  getWorkflowTemplateResultJsonSchema,
  getWorkflowTemplateResultSchema,
} from './template-tools.js';

const addFormats = addFormatsModule.default as unknown as (validator: Ajv) => void;
const choice = {
  id: 'claude-sonnet-5',
  provider: 'anthropic',
  harness: 'pi',
  thinking: 'medium',
  is_default: true,
  price: {input: 3, output: 15},
  reference: {thinking: 'medium', intelligence_index: 80, cost_per_task_usd: 2, scale: 'coding-v1'},
};
const result = {
  template_id: 'ticket-to-pr',
  revision: 1,
  options: [],
  workflow_yaml: 'name: workflow',
  guide_markdown: '# Guide',
  suggested_bindings: {source: ['github-main']},
  suggested_models: {
    fix: {
      reference: {model: 'claude-sonnet-5', thinking: 'medium', intelligence_index: 80},
      note: 'Tested on a coding task.',
      outcome: 'suggested',
      models: [choice, {...choice, thinking: 'low', is_default: false, reference: null}],
      attribution: 'Benchmark source',
    },
  },
};

function schemasAccept(value: unknown) {
  const ajv = new Ajv({strict: true, strictRequired: false});
  addFormats(ajv);
  return [
    getWorkflowTemplateResultSchema.safeParse(value).success,
    ajv.compile(getWorkflowTemplateResultJsonSchema)(value),
  ];
}

describe('workflow template result schemas', () => {
  test('accepts a measured suggestion and a manual choice in both schemas', () => {
    expect(getWorkflowTemplateResultJsonSchema.required).toContain('suggested_models');
    expect(schemasAccept(result)).toEqual([true, true]);
  });

  test('rejects incomplete measured values and unsupported thinking in both schemas', () => {
    const invalidChoice = {
      ...choice,
      thinking: 'unknown',
      reference: {thinking: 'unknown', intelligence_index: 80},
    };
    const invalid = {
      ...result,
      suggested_models: {fix: {...result.suggested_models.fix, models: [invalidChoice]}},
    };

    expect(schemasAccept(invalid)).toEqual([false, false]);
  });

  test('rejects the removed resolved_models field', () => {
    expect(schemasAccept({...result, resolved_models: {}})).toEqual([false, false]);
  });

  test('rejects ranking marks in a list outcome', () => {
    const invalid = {
      ...result,
      suggested_models: {
        fix: {
          ...result.suggested_models.fix,
          outcome: 'list',
          models: [{...choice, below_reference: true}],
        },
      },
    };

    expect(schemasAccept(invalid)).toEqual([false, false]);
  });
});
