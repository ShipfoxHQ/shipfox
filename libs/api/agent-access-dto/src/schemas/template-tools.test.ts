import {Ajv} from 'ajv';
import * as addFormatsModule from 'ajv-formats';
import {
  getWorkflowTemplateResultJsonSchema,
  getWorkflowTemplateResultSchema,
} from './template-tools.js';

const addFormats = addFormatsModule.default as unknown as (validator: Ajv) => void;
const anchor = {
  model: 'gpt-6-luna',
  label: 'GPT 6 Luna',
  lab: 'OpenAI',
  provider: 'shipfox',
  harness: 'pi',
  thinking: 'max',
  provider_required: false,
  is_anchor: true,
  is_default: false,
  intelligence_index: 37.26,
  cost_per_task_usd: 0.069,
  tradeoff: null,
};
const alternative = {
  ...anchor,
  model: 'gpt-6-sol',
  label: 'GPT 6 Sol',
  thinking: 'high',
  is_anchor: false,
  intelligence_index: 42.82,
  cost_per_task_usd: 0.377,
  tradeoff: {
    intelligence: 'slightly_smarter',
    cost: 'much_more_expensive',
    label: 'Slightly smarter, much more expensive',
  },
};
const unscored = {...anchor, intelligence_index: null, cost_per_task_usd: null};
const recommended = {
  placeholders: ['fix'],
  notes: {fix: 'Implements the ticket.'},
  mode: 'recommended',
  choices: [anchor, alternative],
  scale: 'coding-v1',
  attribution: 'Benchmark source',
  cost_note: 'Cost per task is measured on a benchmark workload.',
};
const result = {
  template_id: 'ticket-to-pr',
  revision: 1,
  options: [],
  workflow_yaml: 'name: workflow',
  guide_markdown: '# Guide',
  suggested_bindings: {source: ['github-main']},
  model_recommendations: [
    recommended,
    {placeholders: ['reply'], notes: {}, mode: 'template_default', choices: [unscored]},
    {
      placeholders: ['review'],
      notes: {},
      mode: 'workspace_default',
      choices: [{...unscored, is_anchor: false, is_default: true}],
    },
    {placeholders: ['answer'], notes: {}, mode: 'choose', choices: []},
  ],
};

function schemasAccept(value: unknown) {
  const ajv = new Ajv({strict: true, strictRequired: false});
  addFormats(ajv);
  return [
    getWorkflowTemplateResultSchema.safeParse(value).success,
    ajv.compile(getWorkflowTemplateResultJsonSchema)(value),
  ];
}

function withGroup(group: unknown) {
  return {...result, model_recommendations: [group]};
}

describe('workflow template result schemas', () => {
  test('accepts every recommendation mode in both schemas', () => {
    expect(getWorkflowTemplateResultJsonSchema.required).toContain('model_recommendations');
    expect(schemasAccept(result)).toEqual([true, true]);
  });

  test('rejects a recommended group without its scale, attribution, or cost note', () => {
    const {scale: _scale, ...withoutScale} = recommended;
    const {cost_note: _costNote, ...withoutCostNote} = recommended;

    expect(schemasAccept(withGroup(withoutScale))).toEqual([false, false]);
    expect(schemasAccept(withGroup(withoutCostNote))).toEqual([false, false]);
    expect(schemasAccept(withGroup({...recommended, attribution: null}))).toEqual([false, false]);
  });

  test('rejects more than five recommended choices', () => {
    const choices = [anchor, alternative, alternative, alternative, alternative, alternative];

    expect(schemasAccept(withGroup({...recommended, choices}))).toEqual([false, false]);
  });

  test('rejects scores or comparisons outside recommended mode', () => {
    const scored = {placeholders: ['fix'], notes: {}, mode: 'template_default', choices: [anchor]};
    const compared = {
      placeholders: ['fix'],
      notes: {},
      mode: 'workspace_default',
      choices: [{...unscored, tradeoff: alternative.tradeoff}],
    };

    expect(schemasAccept(withGroup(scored))).toEqual([false, false]);
    expect(schemasAccept(withGroup(compared))).toEqual([false, false]);
  });

  test('rejects choices in choose mode and scale fields in other modes', () => {
    const choose = {placeholders: ['fix'], notes: {}, mode: 'choose', choices: [unscored]};
    const templateDefault = {
      placeholders: ['fix'],
      notes: {},
      mode: 'template_default',
      choices: [unscored],
      scale: 'coding-v1',
    };

    expect(schemasAccept(withGroup(choose))).toEqual([false, false]);
    expect(schemasAccept(withGroup(templateDefault))).toEqual([false, false]);
  });

  test('rejects unsupported thinking and unknown tradeoff keys', () => {
    const invalidThinking = {...recommended, choices: [{...anchor, thinking: 'unknown'}]};
    const invalidTradeoff = {
      ...recommended,
      choices: [anchor, {...alternative, tradeoff: {...alternative.tradeoff, cost: 'free'}}],
    };

    expect(schemasAccept(withGroup(invalidThinking))).toEqual([false, false]);
    expect(schemasAccept(withGroup(invalidTradeoff))).toEqual([false, false]);
  });

  test('rejects a group without placeholders', () => {
    expect(schemasAccept(withGroup({...recommended, placeholders: []}))).toEqual([false, false]);
    expect(schemasAccept(withGroup({...recommended, placeholders: ['']}))).toEqual([false, false]);
  });

  test('rejects the removed suggested_models field', () => {
    expect(schemasAccept({...result, suggested_models: {}})).toEqual([false, false]);
  });
});
