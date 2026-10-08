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
  it('passes exactly the requested environment', async () => {
    const host = new LocalExecutionHost();
    const child = host.spawn({
      argv: ['sh', '-c', `echo "$GREETING/\${HOME-unset}"`],
      env: {PATH: process.env.PATH ?? '', GREETING: 'hello'},
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.resume();

    await child.exited;

    expect(Buffer.concat(chunks).toString()).toBe('hello/unset\n');
  });

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
