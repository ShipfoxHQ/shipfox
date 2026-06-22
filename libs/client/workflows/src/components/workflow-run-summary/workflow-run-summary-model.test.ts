import type {RunResponseDto} from '@shipfox/api-workflows-dto';
import {runShortId, toWorkflowRunSummary} from './workflow-run-summary-model.js';

describe('runShortId', () => {
  test('keeps short ids unchanged', () => {
    const shortId = runShortId('abc123');

    expect(shortId).toBe('abc123');
  });

  test('truncates long ids to their first eight characters', () => {
    const shortId = runShortId('66666666-6666-4666-8666-666666666666');

    expect(shortId).toBe('66666666');
  });
});

describe('toWorkflowRunSummary', () => {
  test('maps identity, status, trigger, and timestamps from the run DTO', () => {
    const model = toWorkflowRunSummary(runDto());

    expect(model).toMatchObject({
      id: '66666666-6666-4666-8666-666666666666',
      shortId: '66666666',
      name: 'deploy-web',
      triggerLabel: 'manual / fire',
      createdAt: '2026-05-07T01:01:00.000Z',
      updatedAt: '2026-05-07T01:02:00.000Z',
    });
    expect(model.status.label).toBe('Running');
    expect(model.status.badge).toBe('info');
  });

  test('omits the trigger label when the run has no trigger source or event', () => {
    const model = toWorkflowRunSummary(runDto({trigger_source: '', trigger_event: ''}));

    expect(model.triggerLabel).toBeUndefined();
  });
});

function runDto(overrides: Partial<RunResponseDto> = {}): RunResponseDto {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    project_id: '44444444-4444-4444-8444-444444444444',
    definition_id: '55555555-5555-4555-8555-555555555555',
    name: 'deploy-web',
    status: 'running',
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {},
    inputs: null,
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}
