import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {runAction, toolResult} from '@shipfox/actions/testing';

const probe = new URL('../fixtures/actions/probe/', import.meta.url);

describe('runAction under node:test', {concurrency: true}, () => {
  for (const name of ['first', 'second']) {
    it(`runs the ${name} action in its own workspace`, async () => {
      const result = await runAction(probe, {
        inputs: {calls: [{alias: 'slack', tool: 'read_thread'}]},
        tools: {slack: {read_thread: () => toolResult({messages: [name]})}},
      });

      assert.equal(result.status, 'succeeded', result.logs);
      assert.equal(result.outputs.cwd, result.workspace.path);
      assert.deepEqual(result.outputs.results, [{messages: [name]}]);
      await result.workspace.remove();
    });
  }
});
