import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {baseE2eEnv, runE2e} from '../src/index.mjs';

const readyServerScript = `
  const {createServer} = require('node:http');
  const {writeFileSync} = require('node:fs');
  const server = createServer((request, response) => response.writeHead(200).end());
  server.listen(Number(process.env.PORT), '127.0.0.1');
  process.on('SIGTERM', () => {
    writeFileSync(process.env.MARKER, 'stopped');
    process.exit(0);
  });
`;

test('baseE2eEnv rejects remote deployments', () => {
  assert.throws(
    () => baseE2eEnv({API_URL: 'https://api.example.test'}),
    /API_URL must target a local host/u,
  );
});

async function unusedPort() {
  const server = createServer();
  server.listen({host: '127.0.0.1', port: 0});
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('starts servers in order and shuts down earlier servers when readiness fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shipfox-e2e-harness-'));
  const marker = join(directory, 'first-stopped');
  const firstPort = await unusedPort();
  const secondPort = await unusedPort();

  try {
    await assert.rejects(
      runE2e({
        argv: ['run', '--task', 'harness-test', '--timeout-ms', '100', '--log-dir', directory],
        env: {
          API_URL: `http://127.0.0.1:${firstPort}`,
          CLIENT_URL: `http://127.0.0.1:${secondPort}`,
        },
        servers: [
          {
            name: 'first',
            command: process.execPath,
            args: ['-e', readyServerScript],
            env: {PORT: String(firstPort), MARKER: marker},
            ready: `http://127.0.0.1:${firstPort}`,
          },
          {
            name: 'second',
            command: process.execPath,
            args: ['-e', 'process.exit(0)'],
            env: {PORT: String(secondPort)},
            ready: `http://127.0.0.1:${secondPort}`,
          },
        ],
      }),
      /Timed out waiting/u,
    );

    assert.equal(await readFile(marker, 'utf8'), 'stopped');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
