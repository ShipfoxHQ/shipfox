import assert from 'node:assert/strict';
import {test} from 'node:test';
import {retry} from './retry.js';

const LAST_FAILURE = /failure 3/;

test('returns the first success', async () => {
  assert.equal(await retry(() => Promise.resolve('ok')), 'ok');
});

test('gives up after the attempts and throws the last error', async () => {
  let calls = 0;
  await assert.rejects(
    retry(() => {
      calls += 1;
      return Promise.reject(new Error(`failure ${calls}`));
    }),
    LAST_FAILURE,
  );
});
