import assert from 'node:assert/strict';
import {describe, test} from 'node:test';

import {
  ollamaListenHost,
  preloadModel,
  processIdentityMatches,
  processStartTime,
  processStateMatchesContext,
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

describe('preloadModel', () => {
  test('uses the OpenAI-compatible chat endpoint', async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = (url, init) => {
      calls.push({url, init});
      return new Response('{}', {status: 200});
    };

    try {
      await preloadModel({
        baseUrl: 'http://127.0.0.1:11434',
        model: 'custom:model',
        keepAlive: '2h',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:11434/v1/chat/completions');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      model: 'custom:model',
      messages: [{role: 'user', content: 'Reply with OK.'}],
      max_tokens: 16,
      stream: false,
      keep_alive: '2h',
    });
  });

  test('reads the completion response body instead of cancelling it', async () => {
    const originalFetch = globalThis.fetch;
    let bodyRead = false;
    let bodyCancelled = false;
    globalThis.fetch = () => ({
      ok: true,
      json: () => {
        bodyRead = true;
        return {};
      },
      body: {
        cancel: () => {
          bodyCancelled = true;
        },
      },
    });

    try {
      await preloadModel({
        baseUrl: 'http://127.0.0.1:11434',
        model: 'custom:model',
        keepAlive: '2h',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(bodyRead, true);
    assert.equal(bodyCancelled, false);
  });
});

describe('processIdentityMatches', () => {
  test('matches a process by pid and recorded start time', () => {
    const currentStartTime = processStartTime(process.pid);
    if (currentStartTime === undefined) throw new Error('Current process start time unavailable');
    const matchingState = {pid: process.pid, processStartTime: currentStartTime};

    const result = processIdentityMatches(matchingState);

    assert.equal(result, true);
  });

  test('rejects a reused pid with a different start time', () => {
    const state = {
      pid: process.pid,
      processStartTime: 'Mon Jan  1 00:00:00 2001',
    };

    const result = processIdentityMatches(state);

    assert.equal(result, false);
  });

  test('rejects process state without a start time', () => {
    const state = {pid: process.pid};

    const result = processIdentityMatches(state);

    assert.equal(result, false);
  });
});

describe('processStateMatchesContext', () => {
  test('matches a managed process by listen host', () => {
    const context = serviceContext({SHIPFOX_OLLAMA_BASE_URL: 'http://127.0.0.1:11500'});
    const matchingState = {pid: process.pid, listenHost: '127.0.0.1:11500'};
    const mismatchedState = {pid: process.pid, listenHost: '127.0.0.1:11434'};

    const matchingResult = processStateMatchesContext(matchingState, context);
    const mismatchedResult = processStateMatchesContext(mismatchedState, context);

    assert.equal(matchingResult, true);
    assert.equal(mismatchedResult, false);
  });
});
