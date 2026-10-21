import {seedPosthogMock} from '@shipfox/e2e-driver-posthog';
import {startPosthogMock} from '@shipfox/e2e-harness';
import {type ContractFakeAdapter, ephemeralEndpoint, field, requiredField} from './shared.js';

/** What the PostHog tool adapter needs to call the fake as the connection's project. */
export interface PosthogContractAccess {
  apiKey: string;
  projectId: string;
  organizationId: string;
  apiBaseUrl: string;
  mcpEndpoint: string;
}

/**
 * PostHog, whose fake answers by API key. The adapter seeds a key of its own with the events, the
 * feature flags, the insight, the dashboard, the experiments, the survey, and the error-tracking
 * issue of the sandbox. The insight counts the `event` fixture, as the sandbox insight does.
 */
export const posthogContractFake: ContractFakeAdapter<PosthogContractAccess> = async ({
  uniqueId,
  cleanups,
}) => {
  const apiKey = `phx_contracts_${uniqueId}`;
  const mock = await startPosthogMock(ephemeralEndpoint());
  cleanups.push(() => mock.stop());
  const apiBaseUrl = mock.endpoint.toString();
  const mcpEndpoint = new URL('/mcp', mock.endpoint).toString();
  const env = {POSTHOG_API_BASE_URL: apiBaseUrl, POSTHOG_MCP_ENDPOINT: mcpEndpoint};
  return {
    env,
    access: {
      apiKey,
      projectId: `contracts-project-${uniqueId}`,
      organizationId: `contracts-organization-${uniqueId}`,
      apiBaseUrl,
      mcpEndpoint,
    },
    seed: async (fixtures) => {
      // Reads the named fixtures the sandbox has, each through a getter that rejects a missing field.
      const seeded = <T>(
        fixtureNames: string[],
        build: (fixture: {
          fixtureName: string;
          required: (name: string) => string | number | boolean;
          optional: (name: string) => string | number | boolean | undefined;
        }) => T,
      ): T[] =>
        fixtureNames.flatMap((fixtureName) => {
          const fixture = fixtures[fixtureName];
          if (fixture === undefined) return [];
          return [
            build({
              fixtureName,
              required: (name) => requiredField({provider: 'posthog', fixture, fixtureName, name}),
              optional: (name) => field({fixture, name}),
            }),
          ];
        });
      const events = seeded(['event', 'purchase_event'], ({required}) => ({
        name: String(required('name')),
        count: Number(required('count')),
      }));
      const countedEvent = fixtures.event === undefined ? undefined : events[0]?.name;
      // The driver finds the fake through the environment.
      Object.assign(process.env, env);
      await seedPosthogMock({
        apiKey,
        seed: {
          events,
          feature_flags: seeded(
            ['feature_flag', 'disabled_feature_flag'],
            ({fixtureName, required}) => ({
              id: Number(required('id')),
              key: String(required('key')),
              ...(fixtureName === 'disabled_feature_flag' ? {active: false} : {}),
            }),
          ),
          insights: seeded(['insight'], ({required}) => ({
            id: Number(required('id')),
            short_id: String(required('short_id')),
            name: String(required('name')),
            ...(countedEvent === undefined ? {} : {event: countedEvent}),
          })),
          dashboards: seeded(['dashboard'], ({required}) => ({
            id: Number(required('id')),
            name: String(required('name')),
          })),
          experiments: seeded(
            ['experiment', 'experiment_results'],
            ({fixtureName, required, optional}) => {
              const flagKey = optional('feature_flag_key');
              return {
                id: Number(required('id')),
                name: String(required('name')),
                ...(flagKey === undefined ? {} : {feature_flag_key: String(flagKey)}),
                ...(fixtureName === 'experiment_results'
                  ? {
                      results: {
                        exposures: Number(required('exposures_per_variant')),
                        control_sum: Number(required('control_sum')),
                        test_sum: Number(required('test_sum')),
                      },
                    }
                  : {}),
              };
            },
          ),
          surveys: seeded(['survey'], ({required}) => ({
            id: String(required('id')),
            name: String(required('name')),
            questions: [String(required('question'))],
          })),
          error_issues: seeded(['error_issue'], ({required}) => ({
            id: String(required('id')),
            name: String(required('name')),
          })),
        },
      });
    },
    // PostHog is read-only for Shipfox.
    writes: () => [],
  };
};
