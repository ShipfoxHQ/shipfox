import {
  AGENT_ACCESS_ACTION_INPUTS_MAX_BYTES,
  cancelWorkflowRunInputSchema,
  createDevRunInputJsonSchema,
  createDevRunInputSchema,
  fireManualTriggerInputJsonSchema,
  fireManualTriggerInputSchema,
  rerunWorkflowRunInputSchema,
} from './action-tools.js';

const uuid = '00000000-0000-4000-8000-000000000001';

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

  test('requires config_path for development runs', () => {
    const input = {
      project_id: uuid,
      ref: 'main',
      trigger: 'manual',
    };
    expect(createDevRunInputSchema.safeParse(input).success).toBe(false);
    expect(
      createDevRunInputSchema.safeParse({...input, config_path: '.shipfox/workflow.yml'}).success,
    ).toBe(true);
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
