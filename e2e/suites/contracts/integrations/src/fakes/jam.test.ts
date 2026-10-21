import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {CONTRACT_FAKE_ADAPTERS} from './index.js';
import {jamContractFake} from './jam.js';

const videoJamId = '4ea19ea4-b021-474f-b254-5df55d37d702';

describe('jamContractFake', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  function arrange() {
    return jamContractFake({uniqueId: 'unique', cleanups});
  }

  it('serves the sandbox Jams to a token of its own, with nothing to seed', async () => {
    const fake = await arrange();

    await fake.seed({video: {id: videoJamId}});
    const client = new Client({name: 'jam-contract-fake-test', version: '0.0.0'});
    await client.connect(
      new StreamableHTTPClientTransport(new URL(fake.access.mcpEndpoint), {
        requestInit: {headers: {authorization: `Bearer ${fake.access.token}`}},
      }) as unknown as Transport,
    );
    const result = CallToolResultSchema.parse(
      await client.callTool(
        {name: 'getDetails', arguments: {jamId: videoJamId}},
        CallToolResultSchema,
      ),
    );
    await client.close();

    expect(fake.access).toMatchObject({token: 'jam_pat_contracts_unique'});
    expect(fake.env).toEqual({
      JAM_API_BASE_URL: expect.any(String),
      JAM_MCP_ENDPOINT: fake.access.mcpEndpoint,
    });
    expect(result.isError).not.toBe(true);
    const [details] = result.content;
    expect(details?.type === 'text' && JSON.parse(details.text)).toMatchObject({
      jamId: videoJamId,
      type: 'video',
    });
    expect(fake.writes()).toEqual([]);
  });

  it('stops the fake with the run cleanups', async () => {
    const fake = await arrange();

    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();

    await expect(fetch(fake.access.mcpEndpoint, {method: 'POST'})).rejects.toThrow();
  });

  it('is the adapter of the jam provider', () => {
    expect(CONTRACT_FAKE_ADAPTERS.jam).toBe(jamContractFake);
  });
});
