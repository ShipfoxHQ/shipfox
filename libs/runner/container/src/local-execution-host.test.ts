import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalExecutionHost} from '#local-execution-host.js';
import {describeExecutionHostContract} from '#testing/execution-host-contract.js';

describeExecutionHostContract('LocalExecutionHost', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-local-host-')));
  return {
    host: new LocalExecutionHost(),
    directory,
    dispose: () => rm(directory, {recursive: true, force: true}),
  };
});

describe('LocalExecutionHost', () => {
  it('rejects exited when the working directory does not exist', async () => {
    const host = new LocalExecutionHost();
    const child = host.spawn({
      argv: ['sh', '-c', 'true'],
      cwd: join(tmpdir(), 'shipfox-local-host-missing', 'nowhere'),
      env: {PATH: process.env.PATH ?? ''},
    });
    child.stdout.resume();
    child.stderr.resume();

    await expect(child.exited).rejects.toThrow();
  });
});
