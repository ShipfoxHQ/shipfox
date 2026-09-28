import {runAction} from '@shipfox/actions/testing';

// Runs under both the `threads` and the `forks` project, whose runs overlap.
const probe = new URL('../fixtures/actions/probe/', import.meta.url);

describe.concurrent('runAction workspaces', () => {
  it.each(['first', 'second', 'third'])('gives the %s test its own workspace', async () => {
    const cwd = process.cwd();

    const result = await runAction(probe, {inputs: {sleep_ms: 200}});

    expect(result.status, result.logs).toBe('succeeded');
    expect(result.outputs.cwd).toBe(result.workspace.path);
    expect(await result.workspace.read('cwd.txt')).toBe(result.workspace.path);
    expect(process.cwd()).toBe(cwd);
    await result.workspace.remove();
  });
});
