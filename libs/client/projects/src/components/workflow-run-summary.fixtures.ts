import type {RunDto} from '@shipfox/api-workflows-dto';

const baseRun = {
  project_id: '11111111-1111-4111-8111-111111111111',
  definition_id: '22222222-2222-4222-8222-222222222222',
  name: 'Checkout remediation',
  trigger_source: 'sentry',
  trigger_event: 'issue_alert',
  trigger_payload: {
    issue: 'SENTRY-CHKOUT-9002',
    service: 'checkout-api',
  },
  inputs: null,
  source_snapshot: null,
} satisfies Omit<RunDto, 'id' | 'status' | 'created_at' | 'updated_at'>;

export const failedWorkflowRunSummaryFixture: RunDto = {
  ...baseRun,
  id: '43010000-0000-4000-8000-000000000000',
  status: 'failed',
  created_at: '2026-06-12T10:00:00.000Z',
  updated_at: '2026-06-12T10:10:42.000Z',
};

export const runningWorkflowRunSummaryFixture: RunDto = {
  ...baseRun,
  id: '43090000-0000-4000-8000-000000000000',
  status: 'running',
  created_at: '2026-06-12T11:00:00.000Z',
  updated_at: '2026-06-12T11:12:42.000Z',
};

export const succeededWorkflowRunSummaryFixture: RunDto = {
  ...baseRun,
  id: '42710000-0000-4000-8000-000000000000',
  status: 'succeeded',
  created_at: '2026-06-12T08:00:00.000Z',
  updated_at: '2026-06-12T08:14:34.000Z',
};

export const missingTriggerWorkflowRunSummaryFixture: RunDto = {
  ...baseRun,
  id: '43160000-0000-4000-8000-000000000000',
  status: 'failed',
  trigger_source: '',
  trigger_event: '',
  trigger_payload: {},
  created_at: '2026-06-12T12:00:00.000Z',
  updated_at: '2026-06-12T12:08:08.000Z',
};

export const workflowRunSummaryFixtures = [
  failedWorkflowRunSummaryFixture,
  runningWorkflowRunSummaryFixture,
  succeededWorkflowRunSummaryFixture,
];
