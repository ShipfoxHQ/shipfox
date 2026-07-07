import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from '@shipfox/vitest/vi';
import {
  type FakeOpenAiProviderHandle,
  message,
  providerStateFile,
  readFakeOpenAiProviderState,
  startFakeOpenAiProvider,
  stopFakeOpenAiProvider,
  toolCall,
} from './index.js';

describe('fake OpenAI provider process', () => {
  let stateDirectory: string;
  let provider: FakeOpenAiProviderHandle | undefined;

  beforeEach(async () => {
    stateDirectory = await mkdtemp(join(tmpdir(), 'shipfox-fake-provider-'));
  });

  afterEach(async () => {
    await provider?.stop().catch(() => undefined);
    provider = undefined;
    await rm(stateDirectory, {recursive: true, force: true});
  });

  it('starts a sidecar, serves a scripted OpenAI request, and cleans up state on stop', async () => {
    provider = await startFakeOpenAiProvider({runId: 'lifecycle', stateDirectory});
    const {baseUrl} = provider;
    const script = await provider.createScript({
      id: 'scripted-request',
      model: 'deterministic-output-agent',
      responses: [
        toolCall('set_output', {key: 'message', value: 'fake-tool-output-ok'}),
        message('done'),
      ],
    });

    const result = await fetch(`${script.providerBaseUrl}/chat/completions`, {
      method: 'POST',
      body: JSON.stringify(openAiRequest()),
    });
    const requests = await provider.getRequests(script.id);
    const state = await readFakeOpenAiProviderState({runId: 'lifecycle', stateDirectory});
    await provider.stop();
    provider = undefined;
    const stateAfterStop = await readStateFile('lifecycle');
    const processAliveAfterStop = isProcessAlive(state.pid);

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toMatchObject({
      id: 'chatcmpl-fake-scripted-request-0',
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: 'set_output',
                  arguments: '{"key":"message","value":"fake-tool-output-ok"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    expect(requests).toMatchObject([
      {
        index: 0,
        model: 'deterministic-output-agent',
        tools: ['set_output'],
        message_roles: ['system', 'user'],
        served_response: 'tool_call:set_output',
      },
    ]);
    expect(state).toMatchObject({
      runId: 'lifecycle',
      baseUrl,
    });
    expect(state.pid).toBeGreaterThan(0);
    expect(state.adminToken).toEqual(expect.any(String));
    expect(stateAfterStop).toBeNull();
    expect(processAliveAfterStop).toBe(false);
  });

  it('stops a sidecar from the persisted run state', async () => {
    provider = await startFakeOpenAiProvider({runId: 'teardown', stateDirectory});
    const {baseUrl} = provider;
    const state = await readFakeOpenAiProviderState({runId: 'teardown', stateDirectory});

    await stopFakeOpenAiProvider({runId: 'teardown', stateDirectory});
    provider = undefined;
    const stateAfterStop = await readStateFile('teardown');
    const processAliveAfterStop = isProcessAlive(state.pid);
    const reachable = await isReachable(baseUrl);

    expect(stateAfterStop).toBeNull();
    expect(processAliveAfterStop).toBe(false);
    expect(reachable).toBe(false);
  });

  async function readStateFile(runId: string): Promise<string | null> {
    try {
      const path = providerStateFile({runId, stateDirectory});
      return await readFile(path, 'utf8');
    } catch {
      return null;
    }
  }
});

function openAiRequest() {
  return {
    model: 'deterministic-output-agent',
    messages: [{role: 'system'}, {role: 'user'}],
    tools: [
      {
        type: 'function',
        function: {
          name: 'set_output',
        },
      },
    ],
  };
}

async function isReachable(baseUrl: string): Promise<boolean> {
  try {
    await fetch(`${baseUrl}/healthz`);
    return true;
  } catch {
    return false;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
