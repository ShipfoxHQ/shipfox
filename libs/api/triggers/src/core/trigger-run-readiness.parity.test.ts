import {triggerSubscriptionFactory} from '#test/index.js';
import {SecretInputNotFoundError} from './errors.js';
import {fireCronSubscription} from './fire-cron.js';
import {fireManualSubscription} from './fire-manual.js';
import {
  checkTriggerSecretReadiness,
  type RunSecretInputReference,
} from './trigger-run-readiness.js';

const startRunFromTrigger = vi.fn();
const workflows = {startRunFromTrigger} as never;

interface SecretState {
  workspace: string[];
  project: string[];
}

/** Resolves a secret the way the Secrets module does: project scope first, then workspace. */
function fakeSecrets(state: SecretState) {
  return {
    getSecret: ({key, projectId}: {key: string; projectId?: string | null}) => {
      if (projectId && state.project.includes(key)) {
        return Promise.resolve({value: key, projectId});
      }
      if (state.workspace.includes(key)) return Promise.resolve({value: key, projectId: null});
      return Promise.resolve({value: null, projectId: null});
    },
    definedNames: () => new Set([...state.workspace, ...state.project]),
  };
}

function inputReference(key: string): RunSecretInputReference {
  return {key, locations: [{jobKey: 'deploy', field: 'env', envKey: 'TOKEN'}]};
}

interface Fixture {
  name: string;
  config: Record<string, unknown>;
  secrets: SecretState;
  secretInputs: string[];
  expected: Array<{kind: 'trigger-secret-missing' | 'secret-input-unmapped'; key: string}>;
}

const fixtures: Fixture[] = [
  {
    name: 'a mapped source defined at workspace scope',
    config: {secrets: {DEPLOY_TOKEN: 'WS_TOKEN'}},
    secrets: {workspace: ['WS_TOKEN'], project: []},
    secretInputs: ['DEPLOY_TOKEN'],
    expected: [],
  },
  {
    name: 'a mapped source defined at project scope',
    config: {secrets: {DEPLOY_TOKEN: 'PROJECT_TOKEN'}},
    secrets: {workspace: [], project: ['PROJECT_TOKEN']},
    secretInputs: ['DEPLOY_TOKEN'],
    expected: [],
  },
  {
    name: 'a mapped source defined at neither scope',
    config: {secrets: {DEPLOY_TOKEN: 'GONE_TOKEN'}},
    secrets: {workspace: ['OTHER'], project: ['OTHER_PROJECT']},
    secretInputs: ['DEPLOY_TOKEN'],
    expected: [{kind: 'trigger-secret-missing', key: 'GONE_TOKEN'}],
  },
  {
    name: 'one of two mapped sources missing',
    config: {secrets: {A: 'PRESENT', B: 'GONE_TOKEN'}},
    secrets: {workspace: ['PRESENT'], project: []},
    secretInputs: ['A', 'B'],
    expected: [{kind: 'trigger-secret-missing', key: 'GONE_TOKEN'}],
  },
  {
    name: 'a secret input the mapping does not provide',
    config: {secrets: {A: 'PRESENT'}},
    secrets: {workspace: ['PRESENT'], project: []},
    secretInputs: ['A', 'B'],
    expected: [{kind: 'secret-input-unmapped', key: 'B'}],
  },
  {
    name: 'a secret input with no mapping at all',
    config: {},
    secrets: {workspace: [], project: []},
    secretInputs: ['DEPLOY_TOKEN'],
    expected: [{kind: 'secret-input-unmapped', key: 'DEPLOY_TOKEN'}],
  },
  {
    name: 'a persisted mapping that is not a string map',
    config: {secrets: {DEPLOY_TOKEN: {key: 'PROJECT_TOKEN', projectId: null}}},
    secrets: {workspace: [], project: []},
    secretInputs: ['DEPLOY_TOKEN'],
    expected: [{kind: 'secret-input-unmapped', key: 'DEPLOY_TOKEN'}],
  },
  {
    name: 'a missing source and an unmapped input together',
    config: {secrets: {A: 'GONE_TOKEN'}},
    secrets: {workspace: [], project: []},
    secretInputs: ['A', 'B'],
    expected: [
      {kind: 'trigger-secret-missing', key: 'GONE_TOKEN'},
      {kind: 'secret-input-unmapped', key: 'B'},
    ],
  },
];

const origins = [
  {origin: 'manual', source: 'manual', event: 'fire'},
  {origin: 'cron', source: 'cron', event: 'tick'},
] as const;

describe('trigger readiness parity with the fire paths', () => {
  beforeEach(() => {
    startRunFromTrigger.mockReset();
    startRunFromTrigger.mockResolvedValue({id: crypto.randomUUID(), name: 'Run'});
  });

  describe.each(origins)('$origin fire', ({origin, source, event}) => {
    test.each(fixtures)('$name', async (fixture) => {
      const subscription = await triggerSubscriptionFactory.create({
        source,
        event,
        config: fixture.config,
      });
      const secrets = fakeSecrets(fixture.secrets);

      const issues = checkTriggerSecretReadiness({
        subscription,
        secretInputs: fixture.secretInputs.map(inputReference),
        definedSecretNames: secrets.definedNames(),
      });

      expect(issues.map(({kind, key}) => ({kind, key}))).toEqual(fixture.expected);
      const refuses = await fires({origin, subscription, secrets});
      // A trigger-scoped issue that blocks the start is exactly a fire the pin step refuses.
      expect(refuses).toBe(issues.some((issue) => issue.effect === 'blocks-start'));
      if (refuses) {
        expect(startRunFromTrigger).not.toHaveBeenCalled();
        return;
      }
      // A run that starts without a referenced input is the run whose step fails later.
      const [started] = startRunFromTrigger.mock.calls[0] as [
        {secretInputs?: Record<string, unknown>},
      ];
      for (const key of fixture.secretInputs) {
        const providedToRun = Object.hasOwn(started.secretInputs ?? {}, key);
        const unmapped = issues.some(
          (issue) => issue.kind === 'secret-input-unmapped' && issue.key === key,
        );
        expect(unmapped).toBe(!providedToRun);
      }
    });
  });
});

async function fires(params: {
  origin: 'manual' | 'cron';
  subscription: Awaited<ReturnType<typeof triggerSubscriptionFactory.create>>;
  secrets: ReturnType<typeof fakeSecrets>;
}): Promise<boolean> {
  const {origin, subscription, secrets} = params;
  if (origin === 'cron') {
    const result = await fireCronSubscription({
      workflows,
      secrets: secrets as never,
      subscriptionId: subscription.id,
      scheduledSlot: new Date('2026-07-05T02:00:00.000Z'),
    });
    return result.outcome === 'errored';
  }
  try {
    await fireManualSubscription({
      workflows,
      secrets: secrets as never,
      subscriptionId: subscription.id,
      callerWorkspaceId: subscription.workspaceId,
      userId: crypto.randomUUID(),
    });
    return false;
  } catch (error) {
    if (error instanceof SecretInputNotFoundError) return true;
    throw error;
  }
}
