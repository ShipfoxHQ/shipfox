import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reportOutOfMemoryKills} from '#core/out-of-memory.js';
import type {StepResult} from '#core/step-result.js';

const memoryEvents = (oomKills: number) =>
  `low 0\nhigh 0\nmax 0\noom ${oomKills}\noom_kill ${oomKills}\noom_group_kill 0\n`;

const SUCCESS: StepResult = {success: true, error: null, exit_code: 0};
const FAILURE: StepResult = {
  success: false,
  error: {message: 'Process exited with code 137.', exit_code: 137},
  exit_code: 137,
};

describe('reportOutOfMemoryKills', () => {
  let dir: string;
  let memoryEventsPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'shipfox-out-of-memory-test-'));
    memoryEventsPath = join(dir, 'memory.events');
    await writeFile(memoryEventsPath, memoryEvents(2));
  });

  afterEach(async () => {
    await rm(dir, {recursive: true, force: true});
  });

  const report = (result: StepResult, killsAfter: number, signal?: AbortSignal) =>
    reportOutOfMemoryKills({
      memoryEventsPath,
      annotationContext: 'out-of-memory-step',
      ...(signal === undefined ? {} : {signal}),
      run: async () => {
        await writeFile(memoryEventsPath, memoryEvents(killsAfter));
        return result;
      },
    });

  it('returns the result unchanged when the counter does not rise', async () => {
    const result = await report(FAILURE, 2);

    expect(result).toEqual(FAILURE);
  });

  it('adds the kills to the message of a failed step', async () => {
    const result = await report(FAILURE, 4);

    expect(result.error?.message).toBe(
      'Process exited with code 137. The runner ran out of memory during this step and the system killed 2 processes. Reduce the memory the step uses or run it on a runner with more memory.',
    );
    expect(result.annotations).toBeUndefined();
  });

  it('keeps a message that already reports out of memory', async () => {
    const failure: StepResult = {
      ...FAILURE,
      error: {message: 'Killed because the runner ran out of memory.', exit_code: null},
    };

    const result = await report(failure, 3);

    expect(result).toEqual(failure);
  });

  it('adds a warning annotation to a step that still succeeded', async () => {
    const result = await report(SUCCESS, 3);

    expect(result.success).toBe(true);
    expect(result.annotations).toEqual([
      {
        op: 'replace',
        context: 'out-of-memory-step',
        style: 'warning',
        body: 'The runner ran out of memory during this step and the system killed 1 process. The step still finished. Reduce the memory the step uses or run it on a runner with more memory.',
      },
    ]);
  });

  it('does not report a cancelled step', async () => {
    const result = await report(FAILURE, 4, AbortSignal.abort());

    expect(result).toEqual(FAILURE);
  });

  it('runs the step when the host has no memory events file', async () => {
    const result = await reportOutOfMemoryKills({
      memoryEventsPath: undefined,
      annotationContext: 'out-of-memory-step',
      run: () => Promise.resolve(SUCCESS),
    });

    expect(result).toEqual(SUCCESS);
  });
});
