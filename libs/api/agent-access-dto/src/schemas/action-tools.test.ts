import {
  AGENT_ACCESS_ACTION_INPUTS_MAX_BYTES,
  cancelWorkflowRunInputSchema,
  createDevRunInputSchema,
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
});
