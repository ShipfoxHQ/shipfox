import {createFakeOpenAiModelProviderServer, type FakeOpenAiModelProviderServer} from './server.js';

const adminToken = process.env.SHIPFOX_FAKE_OPENAI_ADMIN_TOKEN;

if (!adminToken) {
  process.stderr.write(
    'Fake OpenAI model provider sidecar requires SHIPFOX_FAKE_OPENAI_ADMIN_TOKEN\n',
  );
  process.exit(1);
}

let server: FakeOpenAiModelProviderServer | undefined;

try {
  server = await createFakeOpenAiModelProviderServer({adminToken});
  process.stdout.write(`${JSON.stringify({event: 'ready', baseUrl: server.baseUrl})}\n`);
} catch (error) {
  process.stderr.write(`Fake OpenAI model provider sidecar failed to start: ${String(error)}\n`);
  process.exit(1);
}

async function shutdown(): Promise<void> {
  const activeServer = server;
  server = undefined;
  if (activeServer) await activeServer.stop().catch(() => undefined);
}

process.once('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});

process.once('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});
