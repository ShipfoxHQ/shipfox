import type {
  WorkflowDashboardJob,
  WorkflowDashboardStep,
  WorkflowDashboardViewModel,
} from './workflow-dashboard-types.js';

const now = '2026-06-12T12:10:00Z';

function log(at: string, stream: 'stdout' | 'stderr' | 'system', message: string) {
  return {at, message, stream};
}

function step(
  overrides: Partial<WorkflowDashboardStep> & Pick<WorkflowDashboardStep, 'name' | 'status'>,
): WorkflowDashboardStep {
  return {
    attemptCount: overrides.attempts?.length ?? 1,
    attempts: [],
    command: `shipfox run ${overrides.name}`,
    duration: 12,
    kind: 'command',
    ...overrides,
  };
}

const remediateCheckoutSteps: WorkflowDashboardStep[] = [
  step({
    attempts: [
      {
        duration: 18,
        exitCode: 0,
        logs: [
          log('2026-06-12T12:02:06Z', 'system', 'activity started'),
          log('2026-06-12T12:02:11Z', 'stdout', 'loaded Sentry event context'),
        ],
        number: 1,
        output: {incident: 'SENTRY-9Z4K', release: 'checkout-api@8f13c4d'},
        startedAt: '2026-06-12T12:02:06Z',
        status: 'succeeded',
      },
    ],
    command: 'sentry.issue.fetch --id SENTRY-9Z4K --include traces',
    duration: 18,
    kind: 'integration',
    name: 'triage_alert',
    status: 'succeeded',
  }),
  step({
    attempts: [
      {
        duration: 33,
        exitCode: 0,
        logs: [
          log('2026-06-12T12:02:25Z', 'stdout', 'found recent deploy checkout-api@8f13c4d'),
          log('2026-06-12T12:02:34Z', 'stdout', 'regression window confirmed'),
        ],
        number: 1,
        output: {commit: '8f13c4d', suspect: true},
        startedAt: '2026-06-12T12:02:24Z',
        status: 'succeeded',
      },
    ],
    command: 'gh deployment list --env prod --limit 5',
    duration: 33,
    kind: 'command',
    name: 'inspect_recent_deploys',
    status: 'succeeded',
  }),
  step({
    attempts: [
      {
        duration: 114,
        exitCode: 0,
        logs: [
          log('2026-06-12T12:03:04Z', 'stdout', 'patched idempotency lookup'),
          log('2026-06-12T12:04:38Z', 'stdout', 'opened PR shipfox/checkout-api#1182'),
        ],
        number: 1,
        output: {pr: 1182, files_changed: 3},
        startedAt: '2026-06-12T12:03:02Z',
        status: 'succeeded',
      },
    ],
    command: 'agent apply-fix --scope checkout-api --issue SENTRY-9Z4K',
    duration: 114,
    kind: 'agent',
    name: 'produce_fix',
    status: 'succeeded',
  }),
  step({
    attempts: [
      {
        duration: 44,
        exitCode: 1,
        gateResult: {exitCode: 1, passed: false, source: 'exitCode'},
        logs: [
          log('2026-06-12T12:05:02Z', 'stdout', 'running payment regression suite'),
          log(
            '2026-06-12T12:05:42Z',
            'stderr',
            'expected checkout idempotency token to be persisted',
          ),
          log('2026-06-12T12:05:46Z', 'system', 'gate rejected result'),
        ],
        number: 1,
        startedAt: '2026-06-12T12:05:01Z',
        status: 'failed',
      },
      {
        duration: 71,
        exitCode: 0,
        gateResult: {exitCode: 0, passed: true, source: 'exitCode'},
        logs: [
          log('2026-06-12T12:07:08Z', 'stdout', 'running payment regression suite'),
          log('2026-06-12T12:08:18Z', 'stdout', '42 tests passed'),
        ],
        number: 2,
        startedAt: '2026-06-12T12:07:07Z',
        status: 'succeeded',
      },
    ],
    attemptCount: 2,
    command: 'pnpm test --filter checkout-api -- payment-regression.test.ts',
    duration: 115,
    gate: true,
    gateInfo: {
      expr: 'exitCode == 0',
      reason: 'Unit regression must pass before deployment.',
      restartFrom: 'produce_fix',
    },
    kind: 'command',
    name: 'run_unit_tests',
    status: 'succeeded',
  }),
  step({
    attempts: [
      {
        duration: 66,
        exitCode: 0,
        logs: [
          log('2026-06-12T12:08:26Z', 'stdout', 'deploying checkout-api canary'),
          log('2026-06-12T12:09:16Z', 'stdout', 'canary reached healthy state'),
        ],
        number: 1,
        startedAt: '2026-06-12T12:08:24Z',
        status: 'succeeded',
      },
    ],
    command: 'shipfox deploy checkout-api --canary 10',
    duration: 66,
    kind: 'deploy',
    name: 'deploy_canary',
    status: 'succeeded',
  }),
  step({
    attempts: [
      {
        duration: 41,
        exitCode: 0,
        logs: [
          log('2026-06-12T12:09:24Z', 'stdout', 'polling Sentry issue health'),
          log('2026-06-12T12:10:04Z', 'stdout', 'error rate returned to baseline'),
        ],
        number: 1,
        output: {error_rate: '0.01%', recovered: true},
        startedAt: '2026-06-12T12:09:23Z',
        status: 'succeeded',
      },
    ],
    command: 'sentry.issue.monitor --id SENTRY-9Z4K --window 5m',
    duration: 41,
    kind: 'integration',
    name: 'verify_sentry_recovery',
    status: 'succeeded',
  }),
];

const validateReleaseSteps: WorkflowDashboardStep[] = [
  step({
    attempts: [
      {
        duration: 23,
        exitCode: 0,
        logs: [log('2026-06-12T12:04:07Z', 'stdout', 'schema validation passed')],
        number: 1,
        startedAt: '2026-06-12T12:04:05Z',
        status: 'succeeded',
      },
    ],
    command: 'pnpm lint && pnpm typecheck',
    duration: 23,
    name: 'static_checks',
    status: 'succeeded',
  }),
  step({
    attempts: [],
    attemptCount: 0,
    command: 'notify #checkout-release',
    duration: null,
    kind: 'notify',
    name: 'notify_release_channel',
    notRunLog: [log(now, 'system', 'Skipped because remediation completed in the primary job.')],
    status: 'cancelled',
  }),
];

const failedUnitTestAttempt = remediateCheckoutSteps.find((s) => s.name === 'run_unit_tests')
  ?.attempts[0];

if (!failedUnitTestAttempt) {
  throw new Error('Workflow dashboard fixture is missing the failed unit test attempt.');
}

const failedRunJobs: WorkflowDashboardJob[] = [
  {
    duration: 291,
    name: 'remediate_checkout',
    status: 'running',
    steps: remediateCheckoutSteps.map((s) =>
      s.name === 'verify_sentry_recovery'
        ? {...s, attempts: [], attemptCount: 0, duration: null, status: 'pending'}
        : s,
    ),
  },
  {
    duration: null,
    name: 'validate_release',
    needs: 'remediate_checkout',
    status: 'pending',
    steps: validateReleaseSteps.map((s) => ({
      ...s,
      attempts: [],
      attemptCount: 0,
      duration: null,
      status: 'pending',
    })),
  },
];

const succeededRunJobs: WorkflowDashboardJob[] = [
  {
    duration: 427,
    name: 'remediate_checkout',
    status: 'succeeded',
    steps: remediateCheckoutSteps,
  },
  {
    duration: 23,
    name: 'validate_release',
    needs: 'remediate_checkout',
    status: 'succeeded',
    steps: validateReleaseSteps,
  },
];

export const workflowDashboardFixture: WorkflowDashboardViewModel = {
  runOrder: ['two-gates-retried', 'active-remediation', 'failed-release'],
  runs: {
    'two-gates-retried': {
      duration: 1642,
      focus: {attempt: 1, job: 'remediate_checkout', step: 'verify_sentry_recovery'},
      jobs: succeededRunJobs.map((job) =>
        job.name === 'remediate_checkout'
          ? {...job, duration: 1400}
          : job.name === 'validate_release'
            ? {...job, duration: 242}
            : job,
      ),
      number: 4288,
      observedUntil: '2026-06-12T10:10:00Z',
      status: 'succeeded',
      trigger: {
        alertAt: '2026-06-12T12:01:58Z',
        event: 'issue.alert',
        filter: 'environment:production service:checkout-api',
        incident: 'SENTRY-CHKOUT-9002',
        payload: {culprit: 'POST /checkout', level: 'error', project: 'checkout-api'},
        runStartedAt: '2026-06-12T12:02:04Z',
        source: 'sentry',
      },
    },
    'active-remediation': {
      duration: 366,
      focus: {attempt: 1, job: 'remediate_checkout', step: 'deploy_canary'},
      jobs: failedRunJobs.map((job) =>
        job.name === 'remediate_checkout'
          ? {
              ...job,
              status: 'running',
              steps: job.steps.map((s) =>
                s.name === 'deploy_canary'
                  ? {
                      ...s,
                      attempts: [
                        {
                          duration: 87,
                          exitCode: null,
                          logs: [
                            log('2026-06-12T12:09:09Z', 'stdout', 'deploying checkout-api canary'),
                            log('2026-06-12T12:10:00Z', 'system', 'waiting for health checks'),
                          ],
                          number: 1,
                          startedAt: '2026-06-12T12:09:08Z',
                          status: 'running',
                        },
                      ],
                      attemptCount: 1,
                      duration: null,
                      status: 'running',
                    }
                  : s,
              ),
            }
          : job,
      ),
      number: 4289,
      observedUntil: now,
      status: 'running',
      trigger: {
        alertAt: '2026-06-12T12:01:58Z',
        event: 'issue.alert',
        filter: 'environment:production service:checkout-api',
        incident: 'SENTRY-CHKOUT-9002',
        payload: {culprit: 'POST /checkout', level: 'error', project: 'checkout-api'},
        runStartedAt: '2026-06-12T12:02:04Z',
        source: 'sentry',
      },
    },
    'failed-release': {
      duration: 233,
      focus: {attempt: 1, job: 'remediate_checkout', step: 'run_unit_tests'},
      jobs: failedRunJobs.map((job) =>
        job.name === 'remediate_checkout'
          ? {
              ...job,
              status: 'failed',
              steps: job.steps.map((s) =>
                s.name === 'run_unit_tests'
                  ? {
                      ...s,
                      attempts: [failedUnitTestAttempt],
                      attemptCount: 1,
                      duration: 44,
                      status: 'failed',
                    }
                  : s.name === 'deploy_canary' || s.name === 'verify_sentry_recovery'
                    ? {...s, attempts: [], attemptCount: 0, duration: null, status: 'cancelled'}
                    : s,
              ),
            }
          : {...job, status: 'cancelled'},
      ),
      number: 4287,
      observedUntil: '2026-06-12T12:05:47Z',
      status: 'failed',
      trigger: {
        alertAt: '2026-06-12T12:01:58Z',
        event: 'issue.alert',
        filter: 'environment:production service:checkout-api',
        incident: 'SENTRY-CHKOUT-9002',
        payload: {culprit: 'POST /checkout', level: 'error', project: 'checkout-api'},
        runStartedAt: '2026-06-12T12:02:04Z',
        source: 'sentry',
      },
    },
  },
  workflow: {
    sourcePath: '.shipfox/workflows/checkout-remediation.yaml',
    yaml: `name: checkout-remediation
on:
  sentry:
    project: checkout-api
    environment: production

jobs:
  remediate_checkout:
    steps:
      - id: triage_alert
        uses: sentry.issue.fetch
      - id: inspect_recent_deploys
        run: gh deployment list --env prod --limit 5
      - id: produce_fix
        uses: agent.apply-fix
      - id: run_unit_tests
        run: pnpm test --filter checkout-api -- payment-regression.test.ts
        gate:
          success_if: exitCode == 0
          on_failure:
            restartFrom: produce_fix
      - id: deploy_canary
        run: shipfox deploy checkout-api --canary 10
      - id: verify_sentry_recovery
        uses: sentry.issue.monitor
  validate_release:
    needs: remediate_checkout
    steps:
      - id: static_checks
        run: pnpm lint && pnpm typecheck
      - id: notify_release_channel
        uses: slack.notify`,
  },
};
