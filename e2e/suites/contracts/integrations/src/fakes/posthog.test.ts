import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {CONTRACT_FAKE_ADAPTERS} from './index.js';
import {type PosthogContractAccess, posthogContractFake} from './posthog.js';
import type {ContractFake, SandboxFixtures} from './shared.js';

const fixtures: SandboxFixtures = {
  project: {id: 295166, region: 'eu'},
  event: {name: 'contract_event', count: 40},
  purchase_event: {name: 'contract_purchase', count: 10},
  feature_flag: {id: 301243, key: 'contract-flag'},
  disabled_feature_flag: {id: 301244, key: 'contract-flag-disabled'},
  insight: {id: 6355500, short_id: 'wTSHwcPR', name: 'Contract fixture insight'},
  dashboard: {id: 999696, name: 'Contract fixture dashboard'},
  experiment: {id: 99531, name: 'Contract fixture experiment'},
  experiment_results: {
    id: 99702,
    name: 'Contract results experiment',
    feature_flag_key: 'contract-results-experiment',
    exposures_per_variant: 30,
    control_sum: 30,
    test_sum: 45,
  },
  survey: {id: 'survey-1', name: 'Contract fixture survey', question: 'What do you think?'},
  error_issue: {id: 'issue-1', name: 'ContractError'},
};

const missingCountPattern = /posthog fixture "event" has no "count"/u;

describe('posthogContractFake', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  function arrange() {
    return posthogContractFake({uniqueId: 'unique', cleanups});
  }

  // A tool step calls PostHog's `exec` tool with `call --json`, which returns the tool's JSON.
  async function call({
    fake,
    tool,
    args = {},
  }: {
    fake: ContractFake<PosthogContractAccess>;
    tool: string;
    args?: Record<string, unknown>;
  }): Promise<unknown> {
    const client = new Client({name: 'posthog-contract-fake-test', version: '0.0.0'});
    await client.connect(
      new StreamableHTTPClientTransport(new URL(fake.access.mcpEndpoint), {
        requestInit: {headers: {authorization: `Bearer ${fake.access.apiKey}`}},
      }) as unknown as Transport,
    );
    try {
      const result = CallToolResultSchema.parse(
        await client.callTool(
          {name: 'exec', arguments: {command: `call --json ${tool} ${JSON.stringify(args)}`}},
          CallToolResultSchema,
        ),
      );
      const [block] = result.content;
      if (result.isError === true || block?.type !== 'text') {
        throw new Error(`PostHog ${tool} failed: ${JSON.stringify(result.content)}`);
      }
      return JSON.parse(block.text) as unknown;
    } finally {
      await client.close();
    }
  }

  it('serves the fake behind a key of its own, at the addresses in its environment', async () => {
    const fake = await arrange();

    expect(fake.access).toMatchObject({
      apiKey: 'phx_contracts_unique',
      projectId: 'contracts-project-unique',
      organizationId: 'contracts-organization-unique',
    });
    expect(fake.env).toEqual({
      POSTHOG_API_BASE_URL: fake.access.apiBaseUrl,
      POSTHOG_MCP_ENDPOINT: fake.access.mcpEndpoint,
    });
    expect(new URL(fake.access.mcpEndpoint).pathname).toBe('/mcp');
    expect(fake.writes()).toEqual([]);
  });

  it('seeds its key with the sandbox fixtures', async () => {
    const fake = await arrange();

    await fake.seed(fixtures);

    expect(
      await call({fake, tool: 'feature-flag-get-all', args: {key: 'contract-flag-disabled'}}),
    ).toMatchObject({results: [{id: 301244, key: 'contract-flag-disabled', active: false}]});
    expect(await call({fake, tool: 'insight-query', args: {insightId: 6355500}})).toEqual({
      insight: {id: 6355500, short_id: 'wTSHwcPR', name: 'Contract fixture insight'},
      results: [{count: 40, label: 'contract_event'}],
    });
    expect(await call({fake, tool: 'dashboards-get-all'})).toEqual({
      count: 1,
      results: [{id: 999696, name: 'Contract fixture dashboard'}],
    });
    expect(await call({fake, tool: 'experiment-get', args: {id: 99531}})).toEqual({
      id: 99531,
      name: 'Contract fixture experiment',
      status: 'draft',
      feature_flag_key: '',
    });
    expect(await call({fake, tool: 'experiment-results-get', args: {id: 99702}})).toMatchObject({
      experiment: {id: 99702, status: 'stopped'},
      exposures: {total_exposures: {control: 30, test: 30}},
      metrics: {
        primary: {
          results: [
            {
              data: {
                baseline: {key: 'control', sum: 30},
                variant_results: [{key: 'test', sum: 45}],
              },
            },
          ],
        },
      },
    });
    expect(await call({fake, tool: 'survey-get', args: {id: 'survey-1'}})).toMatchObject({
      id: 'survey-1',
      questions: [{question: 'What do you think?'}],
    });
    expect(await call({fake, tool: 'query-error-tracking-issues-list'})).toEqual({
      hasMore: false,
      results: [{id: 'issue-1', name: 'ContractError', status: 'active'}],
    });
  });

  it('seeds only the fixtures the sandbox has, and rejects one without its fields', async () => {
    const fake = await arrange();

    await fake.seed({});

    expect(await call({fake, tool: 'dashboards-get-all'})).toEqual({count: 0, results: []});
    await expect(fake.seed({event: {name: 'contract_event'}})).rejects.toThrow(missingCountPattern);
  });

  it('stops the fake with the run cleanups', async () => {
    const fake = await arrange();

    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();

    await expect(fetch(fake.access.apiBaseUrl)).rejects.toThrow();
  });

  it('is the adapter of the posthog provider', () => {
    expect(CONTRACT_FAKE_ADAPTERS.posthog).toBe(posthogContractFake);
  });
});
