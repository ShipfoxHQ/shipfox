import {Ajv} from 'ajv';
import * as addFormatsModule from 'ajv-formats';
import {
  AGENT_ACCESS_ACTION_INPUTS_MAX_BYTES,
  cancelWorkflowRunInputSchema,
  createDevRunInputJsonSchema,
  createDevRunInputSchema,
  createDevRunResultJsonSchema,
  createDevRunResultSchema,
  fireManualTriggerInputJsonSchema,
  fireManualTriggerInputSchema,
  rerunWorkflowRunInputSchema,
} from './action-tools.js';

const uuid = '00000000-0000-4000-8000-000000000001';
const addFormats = addFormatsModule.default as unknown as (validator: Ajv) => void;

describe('agent-access action tool schemas', () => {
  test('requires retry identity and rerun mode', () => {
    expect(cancelWorkflowRunInputSchema.safeParse({run_id: uuid}).success).toBe(false);
    expect(
      cancelWorkflowRunInputSchema.safeParse({run_id: uuid, expected_attempt: 1}).success,
    ).toBe(true);
    expect(rerunWorkflowRunInputSchema.safeParse({run_id: uuid, expected_attempt: 1}).success).toBe(
      false,
    );
    expect(
      rerunWorkflowRunInputSchema.safeParse({run_id: uuid, expected_attempt: 1, mode: 'failed'})
        .success,
    ).toBe(true);
  });

  test('bounds serialized inputs and idempotency keys', () => {
    const inputs = {payload: 'x'.repeat(AGENT_ACCESS_ACTION_INPUTS_MAX_BYTES)};
    expect(fireManualTriggerInputSchema.safeParse({definition_id: uuid, inputs}).success).toBe(
      false,
    );
    expect(
      fireManualTriggerInputSchema.safeParse({
        definition_id: uuid,
        idempotency_key: 'x'.repeat(129),
      }).success,
    ).toBe(false);
    expect(
      fireManualTriggerInputSchema.safeParse({
        definition_id: uuid,
        idempotency_key: 'x',
      }).success,
    ).toBe(true);
  });

  test('accepts only plain JSON objects for inputs', () => {
    const nullPrototypeInputs = Object.create(null) as Record<string, unknown>;
    nullPrototypeInputs.payload = 'value';

    const acceptedInputs = [{payload: 'value'}, nullPrototypeInputs];
    const rejectedInputs = [new Date(), new Map(), new Set()];

    for (const inputs of acceptedInputs) {
      expect(fireManualTriggerInputSchema.safeParse({definition_id: uuid, inputs}).success).toBe(
        true,
      );
    }

    for (const inputs of rejectedInputs) {
      expect(fireManualTriggerInputSchema.safeParse({definition_id: uuid, inputs}).success).toBe(
        false,
      );
    }
  });

  test('accepts local content without a ref and leaves content unbounded by Zod', () => {
    const input = {
      project_id: uuid,
      content: 'x'.repeat(300 * 1024),
      trigger: 'manual',
      config_path: '.shipfox/workflow.yml',
    };

    expect(createDevRunInputSchema.safeParse(input).success).toBe(true);
    expect(createDevRunInputSchema.parse(input).dry_run).toBe(false);
    expect(createDevRunInputJsonSchema.required).toEqual(['project_id', 'config_path', 'trigger']);
    expect(createDevRunInputJsonSchema.properties.content).toEqual({type: 'string'});
  });

  test('requires a ref without local content and rejects a commit without a ref', () => {
    const input = {
      project_id: uuid,
      trigger: 'manual',
      config_path: '.shipfox/workflow.yml',
    };
    expect(createDevRunInputSchema.safeParse(input).success).toBe(false);
    expect(
      createDevRunInputSchema.safeParse({...input, commit: 'a'.repeat(40), content: 'workflow'})
        .success,
    ).toBe(false);
    expect(createDevRunInputSchema.safeParse({...input, ref: 'main'}).success).toBe(true);
    expect(createDevRunInputJsonSchema.anyOf).toEqual([
      {required: ['ref']},
      {required: ['content'], not: {required: ['commit']}},
    ]);
  });

  test('validates development-run results with provenance and warnings', () => {
    const realResult = {
      run_id: uuid,
      run_url: `https://client.example.test/runs/${uuid}`,
      ref: 'main',
      commit: 'a'.repeat(40),
      warnings: [{code: 'unknown-trigger-source', message: 'Unknown source'}],
    };
    const dryRunResult = {
      dry_run: true,
      check_passed: true,
      event_checked: false,
      ref: 'main',
      commit: 'a'.repeat(40),
      warnings: [],
    };

    expect(createDevRunResultSchema.safeParse(realResult).success).toBe(true);
    expect(createDevRunResultSchema.safeParse(dryRunResult).success).toBe(true);
    expect(
      createDevRunResultSchema.safeParse({...dryRunResult, run_url: realResult.run_url}).success,
    ).toBe(false);
    expect(createDevRunResultJsonSchema.required).toEqual(['commit']);
    expect(createDevRunResultJsonSchema.properties.event_checked).toEqual({type: 'boolean'});
    expect(createDevRunResultJsonSchema.properties.run_url).toEqual({
      type: 'string',
      format: 'uri',
    });
    expect(createDevRunResultJsonSchema.properties.warnings).toMatchObject({maxItems: 100});
  });

  test('requires exactly one development-run result variant', () => {
    const commit = 'a'.repeat(40);
    const validResults = [
      {
        run_id: uuid,
        ref: 'main',
        commit,
        warnings: [{code: 'unknown-trigger-source', message: 'Unknown source'}],
      },
      {
        dry_run: true,
        check_passed: true,
        event_checked: true,
        ref: 'main',
        commit,
        warnings: [],
      },
    ];
    const invalidResults = [
      {commit},
      {run_id: uuid, dry_run: true, commit},
      {run_id: uuid, check_passed: true, commit},
      {run_id: uuid, dry_run: true, check_passed: true, commit},
      {run_id: uuid, event_checked: true, commit},
      {dry_run: true, commit},
      {check_passed: true, commit},
    ];
    const ajv = new Ajv({strict: true, strictRequired: false});
    addFormats(ajv);
    const validateResult = ajv.compile(createDevRunResultJsonSchema);
    const validateVariants = createDevRunResultJsonSchema.oneOf.map((variant) =>
      ajv.compile({type: 'object', ...variant}),
    );

    for (const result of validResults) {
      expect(validateResult(result)).toBe(true);
      expect(validateVariants.filter((validate) => validate(result))).toHaveLength(1);
    }

    for (const result of invalidResults) {
      expect(createDevRunResultSchema.safeParse(result).success).toBe(false);
      expect(validateResult(result)).toBe(false);
      expect(validateVariants.filter((validate) => validate(result))).toHaveLength(0);
    }
  });

  test('keeps development-run descriptors aligned with safe runtime strings', () => {
    const refPattern = new RegExp(createDevRunInputJsonSchema.properties.ref.pattern, 'u');
    const configPathPattern = new RegExp(
      createDevRunInputJsonSchema.properties.config_path.pattern,
      'u',
    );
    const values = ['main', 'main\n', 'main\u007f', 'main\u0085', 'main\u2028', 'main\u2029'];

    for (const value of values) {
      const parsed = createDevRunInputSchema.safeParse({
        project_id: uuid,
        ref: value,
        config_path: value,
        trigger: 'manual',
      });
      expect(refPattern.test(value)).toBe(parsed.success);
      expect(configPathPattern.test(value)).toBe(parsed.success);
    }
  });

  test('rejects a top-level __proto__ input key before it can be discarded', () => {
    const inputs = JSON.parse('{"__proto__":{"changed":true}}') as Record<string, unknown>;

    expect(fireManualTriggerInputSchema.safeParse({definition_id: uuid, inputs}).success).toBe(
      false,
    );
    expect(fireManualTriggerInputJsonSchema.properties.inputs.propertyNames).toEqual({
      not: {const: '__proto__'},
    });
  });
});
