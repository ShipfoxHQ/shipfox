import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

import {
  ollamaListenHost,
  processIdentityMatches,
  processStartTime,
  serviceContext,
} from './shared-ollama.mjs';

describe('serviceContext', () => {
  test('stores shared Ollama state under the Conductor root path', () => {
    const context = serviceContext(
      {
        CONDUCTOR_ROOT_PATH: '/repo/root',
      },
      '/repo/worktrees/amsterdam-v1',
    );

    assert.equal(context.rootPath, '/repo/root');
    assert.equal(context.stateDir, '/repo/root/.context/shared-ollama');
    assert.equal(context.pidFile, '/repo/root/.context/shared-ollama/ollama.pid');
    assert.equal(context.stateFile, '/repo/root/.context/shared-ollama/ollama-process.json');
    assert.equal(context.logFile, '/repo/root/.context/shared-ollama/ollama.log');
  });

  test('falls back to cwd outside Conductor', () => {
    const context = serviceContext({}, '/repo/root');

    assert.equal(context.rootPath, '/repo/root');
    assert.equal(context.stateDir, '/repo/root/.context/shared-ollama');
  });

  test('allows overriding the model and endpoint', () => {
    const context = serviceContext(
      {
        SHIPFOX_OLLAMA_BASE_URL: 'http://127.0.0.1:11500',
        SHIPFOX_OLLAMA_KEEP_ALIVE: '2h',
        SHIPFOX_OLLAMA_MODEL: 'custom:model',
      },
      '/repo/root',
    );

    assert.equal(context.baseUrl, 'http://127.0.0.1:11500');
    assert.equal(context.keepAlive, '2h');
    assert.equal(context.model, 'custom:model');
  });
});

describe('ollamaListenHost', () => {
  test('converts the API base URL into the OLLAMA_HOST bind value', () => {
    assert.equal(ollamaListenHost('http://127.0.0.1:11434'), '127.0.0.1:11434');
  });
});

describe('processIdentityMatches', () => {
  test('matches a process by pid and recorded start time', () => {
    const currentStartTime = processStartTime(process.pid);

    assert.equal(typeof currentStartTime, 'string');
    assert.equal(
      processIdentityMatches({pid: process.pid, processStartTime: currentStartTime}),
      true,
    );
    assert.equal(
      processIdentityMatches({
        pid: process.pid,
        processStartTime: 'Mon Jan  1 00:00:00 2001',
      }),
      false,
    );
    assert.equal(processIdentityMatches({pid: process.pid}), false);
  });
});
