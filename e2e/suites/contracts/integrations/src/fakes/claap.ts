import {type ClaapMockSeed, seedClaapMock} from '@shipfox/e2e-driver-claap';
import {startClaapMock} from '@shipfox/e2e-harness';
import {
  type ContractFakeAdapter,
  ephemeralEndpoint,
  field,
  requiredField,
  type SandboxFixtures,
} from './shared.js';

/** What the Claap tool adapter needs to call the fake as the connection's workspace. */
export interface ClaapContractAccess {
  apiKey: string;
  mcpEndpoint: string;
  /** The sandbox's Claap workspace, which `seed` reads. */
  workspace(): {workspaceId: string; name: string};
}

/**
 * Claap, whose fake answers by API key. `seed` gives the adapter's key the sandbox workspace
 * and recordings. The connection is bound to the sandbox's Claap workspace, because a share URL
 * names its workspace and Shipfox refuses one from another. Claap is read-only for Shipfox.
 */
export const claapContractFake: ContractFakeAdapter<ClaapContractAccess> = async ({
  uniqueId,
  cleanups,
}) => {
  const apiKey = `cla_contracts_${uniqueId}`;
  const mock = await startClaapMock(new URL('/mcp', ephemeralEndpoint()));
  cleanups.push(() => mock.stop());
  const mcpEndpoint = mock.endpoint.toString();
  const env = {CLAAP_MCP_ENDPOINT: mcpEndpoint};
  let workspace: ClaapMockSeed['workspace'] | undefined;
  return {
    env,
    access: {
      apiKey,
      mcpEndpoint,
      workspace: () => {
        if (workspace === undefined)
          throw new Error('The Claap fake has no workspace before `seed`.');
        return workspace;
      },
    },
    seed: async (fixtures) => {
      const seed = claapSeed(fixtures);
      // The driver finds the fake through the environment.
      Object.assign(process.env, env);
      await seedClaapMock({apiKey, seed});
      workspace = seed.workspace;
    },
    writes: () => [],
  };
};

// The sandbox fixtures that are recordings. Only `summary_recording` has a summary.
const CLAAP_RECORDING_FIXTURES = ['recording', 'summary_recording'] as const;

/**
 * The Claap fake's seed from the sandbox fixtures: the `workspace`, and each recording fixture,
 * whose `speaker` says its `speech`. The summary is one point in Claap's Markdown, linked to the
 * start of the recording.
 */
export function claapSeed(fixtures: SandboxFixtures): ClaapMockSeed {
  const required = (fixtureName: string, name: string): string => {
    const fixture = fixtures[fixtureName];
    if (fixture === undefined)
      throw new Error(`The claap sandbox has no "${fixtureName}" fixture.`);
    return String(requiredField({provider: 'claap', fixture, fixtureName, name}));
  };
  return {
    workspace: {workspaceId: required('workspace', 'id'), name: required('workspace', 'name')},
    recordings: CLAAP_RECORDING_FIXTURES.flatMap((fixtureName) => {
      const fixture = fixtures[fixtureName];
      if (fixture === undefined) return [];
      const title = required(fixtureName, 'title');
      const speaker = field({fixture, name: 'speaker'});
      const speech = field({fixture, name: 'speech'});
      return [
        {
          recordingId: required(fixtureName, 'id'),
          title,
          url: required(fixtureName, 'url'),
          createdAt: required(fixtureName, 'created_at'),
          transcript:
            speaker === undefined || speech === undefined
              ? []
              : [{speaker: String(speaker), text: String(speech)}],
          ...(fixtureName === 'summary_recording'
            ? {summary: {markdown: `- ${title} %[00:00]()`, state: 'Ready'}}
            : {}),
        },
      ];
    }),
  };
}
