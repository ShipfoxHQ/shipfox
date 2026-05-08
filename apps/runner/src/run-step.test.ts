import {executeRunStep} from '#run-step.js';

const GRANDCHILD_PID_REGEX = /GRANDCHILD_PID=(\d+)/;
const ESRCH_REGEX = /ESRCH/;

describe('executeRunStep', () => {
  it('succeeds with exit code 0', async () => {
    const step = buildStep({config: {run: 'echo hello'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
  });

  it('fails with non-zero exit code', async () => {
    const step = buildStep({config: {run: 'exit 1'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
  });

  it('captures both stdout and stderr', async () => {
    const step = buildStep({config: {run: 'echo out && echo err >&2'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.output).toContain('out');
    expect(result.output).toContain('err');
  });

  it('returns failure for unsupported step type', async () => {
    const step = buildStep({type: 'docker', config: {image: 'node:20'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.output).toContain('Unsupported step type: docker');
  });

  it('returns failure when config.run is missing', async () => {
    const step = buildStep({config: {}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.output).toContain('missing or empty');
  });

  it('handles multi-line scripts', async () => {
    const step = buildStep({
      config: {run: 'echo first\necho second'},
    });

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.output).toContain('first');
    expect(result.output).toContain('second');
  });

  it('fails on first error with pipefail', async () => {
    const step = buildStep({
      config: {run: 'false | echo piped'},
    });

    const result = await executeRunStep(step);

    // With -eo pipefail, the false in the pipe causes failure
    expect(result.success).toBe(false);
  });

  it('kills the running script when the AbortSignal fires', async () => {
    const step = buildStep({config: {run: 'sleep 30'}});
    const ac = new AbortController();
    const promise = executeRunStep(step, {signal: ac.signal});

    // Give the shell a moment to actually spawn before we abort.
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();

    const result = await promise;
    expect(result.success).toBe(false);
  });

  it('kills the entire process group on abort, including grandchildren (codex F9)', async () => {
    // The shell parent has its own pid; the inner sleep is a grandchild whose
    // pid is printed before the wait. Without `detached:true` + `process.kill(-pid)`,
    // killing only the shell would leave the grandchild orphaned.
    const step = buildStep({
      config: {run: 'sleep 30 & echo "GRANDCHILD_PID=$!"; wait'},
    });
    const ac = new AbortController();
    const promise = executeRunStep(step, {signal: ac.signal});

    // Wait until we see the grandchild pid printed.
    await new Promise((r) => setTimeout(r, 200));
    ac.abort();

    const result = await promise;
    expect(result.success).toBe(false);

    const match = result.output.match(GRANDCHILD_PID_REGEX);
    expect(match).not.toBeNull();
    const grandchildPid = Number(match?.[1]);

    // Give the OS a tick to deliver SIGKILL to the group.
    await new Promise((r) => setTimeout(r, 100));

    // process.kill(pid, 0) throws ESRCH if the process is gone — what we want.
    expect(() => process.kill(grandchildPid, 0)).toThrow(ESRCH_REGEX);
  });
});

function buildStep(
  overrides: Partial<{type: string; name: string | null; config: Record<string, unknown>}> = {},
) {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: overrides.name ?? 'test-step',
    type: overrides.type ?? 'run',
    config: overrides.config ?? {run: 'echo test'},
    position: 0,
  };
}
