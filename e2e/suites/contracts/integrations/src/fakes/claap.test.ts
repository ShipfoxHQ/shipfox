import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {type ClaapContractAccess, claapContractFake, claapSeed} from './claap.js';
import {CONTRACT_FAKE_ADAPTERS} from './index.js';
import type {ContractFake, SandboxFixtures} from './shared.js';

const fixtures: SandboxFixtures = {
  workspace: {id: 'sandboxWs1', name: 'Sandbox'},
  recording: {
    id: 'frenchRec01',
    title: 'Untitled',
    url: 'https://app.claap.io/untitled-c-sandboxWs1-frenchRec01',
    created_at: '2026-10-16',
    speaker: 'Noé',
    speech: 'Bonjour, enchanté.',
  },
  summary_recording: {
    id: 'summaryRec1',
    title: 'Demo',
    url: 'https://app.claap.io/demo-c-sandboxWs1-summaryRec1',
    created_at: '2026-10-15',
  },
};

describe('claapContractFake', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  function arrange() {
    return claapContractFake({uniqueId: 'unique', cleanups});
  }

  async function call({
    fake,
    tool,
    args = {},
  }: {
    fake: ContractFake<ClaapContractAccess>;
    tool: string;
    args?: Record<string, unknown>;
  }): Promise<unknown> {
    const client = new Client({name: 'claap-contract-fake-test', version: '0.0.0'});
    await client.connect(
      new StreamableHTTPClientTransport(new URL(fake.access.mcpEndpoint), {
        requestInit: {headers: {authorization: `Bearer ${fake.access.apiKey}`}},
      }) as unknown as Transport,
    );
    try {
      const result = CallToolResultSchema.parse(
        await client.callTool({name: tool, arguments: args}, CallToolResultSchema),
      );
      const [block] = result.content;
      if (result.isError === true || block?.type !== 'text') {
        throw new Error(`Claap ${tool} failed: ${JSON.stringify(result.content)}`);
      }
      return JSON.parse(block.text) as unknown;
    } finally {
      await client.close();
    }
  }

  it('seeds a key of its own with the sandbox workspace and recordings', async () => {
    const fake = await arrange();

    await fake.seed(fixtures);

    expect(fake.access.apiKey).toBe('cla_contracts_unique');
    expect(fake.env).toEqual({CLAAP_MCP_ENDPOINT: fake.access.mcpEndpoint});
    expect(fake.access.workspace()).toEqual({workspaceId: 'sandboxWs1', name: 'Sandbox'});
    expect(await call({fake, tool: 'list_workspaces'})).toEqual({
      workspaces: [{workspaceId: 'sandboxWs1', name: 'Sandbox'}],
    });
    expect(
      await call({
        fake,
        tool: 'get_recording',
        args: {workspaceId: 'sandboxWs1', recordingId: 'summaryRec1'},
      }),
    ).toMatchObject({
      recording: {recordingId: 'summaryRec1'},
      summary: {markdown: '- Demo %[00:00]()', state: 'Ready'},
    });
    expect(
      await call({
        fake,
        tool: 'get_recording_transcript',
        args: {workspaceId: 'sandboxWs1', recordingId: 'frenchRec01'},
      }),
    ).toEqual({transcript: 'Noé: Bonjour, enchanté.\n'});
    expect(fake.writes()).toEqual([]);
  });

  it('has no workspace before it is seeded, and the fake rejects its key', async () => {
    const fake = await arrange();

    expect(() => fake.access.workspace()).toThrow('The Claap fake has no workspace before `seed`.');
    await expect(call({fake, tool: 'list_workspaces'})).rejects.toThrow();
  });

  it('is the adapter of the claap provider', () => {
    expect(CONTRACT_FAKE_ADAPTERS.claap).toBe(claapContractFake);
  });
});

describe('claapSeed', () => {
  it('turns the recording fixtures into recordings, and summarizes the summary recording', () => {
    expect(claapSeed(fixtures)).toEqual({
      workspace: {workspaceId: 'sandboxWs1', name: 'Sandbox'},
      recordings: [
        {
          recordingId: 'frenchRec01',
          title: 'Untitled',
          url: 'https://app.claap.io/untitled-c-sandboxWs1-frenchRec01',
          createdAt: '2026-10-16',
          transcript: [{speaker: 'Noé', text: 'Bonjour, enchanté.'}],
        },
        {
          recordingId: 'summaryRec1',
          title: 'Demo',
          url: 'https://app.claap.io/demo-c-sandboxWs1-summaryRec1',
          createdAt: '2026-10-15',
          transcript: [],
          summary: {markdown: '- Demo %[00:00]()', state: 'Ready'},
        },
      ],
    });
  });

  it('fails on a sandbox without a workspace name', () => {
    expect(() => claapSeed({workspace: {id: 'sandboxWs1'}})).toThrow(
      'The claap fixture "workspace" has no "name".',
    );
  });
});
