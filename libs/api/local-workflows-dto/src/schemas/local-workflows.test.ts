import {
  foxlangExecutionResponseSchema,
  foxlangRunListResponseSchema,
  foxlangWorkflowDetailResponseSchema,
  foxlangWorkflowListResponseSchema,
  triggerFakeAlertBodySchema,
  triggerFakeAlertResponseSchema,
} from './local-workflows.js';

describe('local workflows DTO schemas', () => {
  test('parses a fake alert body', () => {
    const result = triggerFakeAlertBodySchema.parse({
      id: 'alert-001',
      severity: 'critical',
      message: 'checkout conversion degraded',
    });

    expect(result.severity).toBe('critical');
  });

  test('parses the fake monitoring execution response', () => {
    const result = foxlangExecutionResponseSchema.parse({
      status: 'completed',
      run: {
        run: {
          run_id: 'platform-doc-run-001',
          module_id: 'restore_checkout_exec.fox',
          workflow_name: 'restore_checkout',
          status: 'completed',
        },
        trigger_evidence: {
          kind: 'trigger_input',
          value: {
            kind: 'record',
            fields: [
              {name: 'id', value: {kind: 'string', value: 'alert-001'}},
              {name: 'severity', value: {kind: 'string', value: 'critical'}},
            ],
          },
        },
        actions: [
          {
            action_requirement_id:
              'restore_checkout_exec.fox::workflow:restore_checkout::action:001',
            argv: ['printf', 'hello'],
            status: 'succeeded',
            exit_code: 0,
            stdout: 'hello',
            stderr: '',
          },
        ],
        events: [{sequence: 1, kind: 'trigger_received', run_id: 'platform-doc-run-001'}],
      },
    });

    expect(result.run?.actions[0]?.stdout).toBe('hello');
  });

  test('parses workflow list and detail responses', () => {
    const list = foxlangWorkflowListResponseSchema.parse({
      workflows: [
        {
          preparation_id: 'prep-1',
          registered_at: '2026-05-31T12:00:00Z',
          workflow: {
            workflow_id: 'restore_checkout_exec.fox::workflow:restore_checkout',
            module_id: 'restore_checkout_exec.fox',
            name: 'restore_checkout',
            return_type: 'ExecResult',
          },
          triggers: [],
          action_requirements: [],
        },
      ],
    });
    const detail = foxlangWorkflowDetailResponseSchema.parse({
      preparation_id: 'prep-1',
      workflow: {},
      module: {},
      triggers: [],
      required_services: [],
      action_requirements: [],
      source: {
        source_name: 'restore_checkout_exec.fox',
        source_text: 'workflow restore_checkout() {}',
      },
      iface_text: 'interface text',
    });

    expect(list.workflows).toHaveLength(1);
    expect(detail.source.source_name).toBe('restore_checkout_exec.fox');
  });

  test('parses run list and platform fake alert responses', () => {
    const runs = foxlangRunListResponseSchema.parse({
      runs: [
        {
          run_id: 'fake-monitoring-alert-001',
          workflow_name: 'restore_checkout',
          provider_event_id: 'alert-001',
          status: 'completed',
        },
      ],
    });
    const response = triggerFakeAlertResponseSchema.parse({
      run_id: 'fake-monitoring-alert-001',
      result: {
        status: 'input_rejected',
        input_error: {
          kind: 'unknown_trigger_id',
          trigger_id: 'restore_checkout_exec.fox::trigger:checkout_degraded',
        },
      },
    });

    expect(runs.runs[0]?.run_id).toBe('fake-monitoring-alert-001');
    expect(response.result.status).toBe('input_rejected');
  });
});
