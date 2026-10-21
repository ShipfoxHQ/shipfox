import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {CONTRACT_FAKE_ADAPTERS} from './index.js';
import {linearContractFake} from './linear.js';

describe('linearContractFake', () => {
  it('replays the recorded Linear responses for its access token', async () => {
    const cleanups: Array<() => Promise<void>> = [];
    const fake = await linearContractFake({uniqueId: 'unique', cleanups});

    try {
      await fake.seed({});
      const client = new Client({name: 'linear-contract-fake-test', version: '0.0.0'});
      await client.connect(
        new StreamableHTTPClientTransport(new URL(fake.access.endpoint), {
          requestInit: {headers: {authorization: `Bearer ${fake.access.accessToken}`}},
        }) as unknown as Transport,
      );
      const result = await client.callTool(
        {name: 'get_team', arguments: {query: '4016fa95-dfda-4139-88ba-133ba5955b01'}},
        CallToolResultSchema,
      );
      await client.close();

      expect(fake.access.accessToken).toBe('lin_oauth_contracts_unique');
      expect(fake.env).toEqual({LINEAR_MCP_ENDPOINT: fake.access.endpoint});
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(fake.writes()).toEqual([]);
    } finally {
      await Promise.all(cleanups.map((cleanup) => cleanup()));
    }
  });

  it('is the adapter of the linear provider', () => {
    expect(CONTRACT_FAKE_ADAPTERS.linear).toBe(linearContractFake);
  });
});
