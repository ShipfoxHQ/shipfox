import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join} from 'node:path';
import type {StepDto} from '@shipfox/api-workflows-dto';
import {executeRunStep} from '#core/run-step.js';

const GRANDCHILD_PID_REGEX = /GRANDCHILD_PID=(\d+)/;
const ESRCH_REGEX = /ESRCH/;

describe('executeRunStep', () => {
  it('succeeds with exit code 0', async () => {
    const step = buildStep({config: {run: 'echo hello'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
    expect(result.exit_code).toBe(0);
  });

  it('fails with non-zero exit code and reports it on result.error', async () => {
    const step = buildStep({config: {run: 'exit 1'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.error).toEqual({message: 'Command exited with code 1', exit_code: 1});
    expect(result.exit_code).toBe(1);
  });

  it('captures both stdout and stderr', async () => {
    const step = buildStep({config: {run: 'echo out && echo err >&2'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(true);
    expect(result.output).toContain('out');
    expect(result.output).toContain('err');
  });

  it('returns failure for unsupported step type with the reason on error.message', async () => {
    const step = buildStep({type: 'docker', config: {image: 'node:20'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Unsupported step type: docker');
    expect(result.error?.exit_code).toBeUndefined();
    expect(result.output).toBe('');
  });

  it('returns failure when config.run is missing with the reason on error.message', async () => {
    const step = buildStep({config: {}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('missing or empty');
    expect(result.error?.exit_code).toBeUndefined();
  });

  it('reports signal kill on result.error when aborted', async () => {
    const step = buildStep({config: {run: 'sleep 30'}});
    const ac = new AbortController();
    const promise = executeRunStep(step, {signal: ac.signal});

    await new Promise((r) => setTimeout(r, 50));
    ac.abort();

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error?.exit_code).toBeNull();
    expect(result.error?.signal).toBe('SIGKILL');
    expect(result.error?.message).toContain('SIGKILL');
  });

  it('runs the step in the provided cwd', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shipfox-cwd-test-'));
    try {
      const step = buildStep({config: {run: 'pwd'}});

      const result = await executeRunStep(step, {cwd: dir});

      expect(result.success).toBe(true);
      // macOS resolves tmpdir() through a /private symlink, so match the unique
      // mkdtemp suffix rather than the full path.
      expect(result.output).toContain(basename(dir));
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
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

  it('kills the entire process group on abort, including grandchildren', async () => {
    const step = buildStep({
      config: {run: 'sleep 30 & echo "GRANDCHILD_PID=$!"; wait'},
    });
    const ac = new AbortController();
    const promise = executeRunStep(step, {signal: ac.signal});

    await new Promise((r) => setTimeout(r, 200));
    ac.abort();

    const result = await promise;
    expect(result.success).toBe(false);

    const match = result.output.match(GRANDCHILD_PID_REGEX);
    expect(match).not.toBeNull();
    const grandchildPid = Number(match?.[1]);

    await new Promise((r) => setTimeout(r, 100));

    // process.kill(pid, 0) throws ESRCH if the process is gone.
    expect(() => process.kill(grandchildPid, 0)).toThrow(ESRCH_REGEX);
  });
});

function buildStep(
  overrides: Partial<{type: string; name: string | null; config: Record<string, unknown>}> = {},
): StepDto {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    job_id: '00000000-0000-0000-0000-000000000002',
    name: overrides.name ?? 'test-step',
    status: 'running',
    type: overrides.type ?? 'run',
    config: overrides.config ?? {run: 'echo test'},
    error: null,
    position: 0,
    current_attempt: 1,
    duration_ms: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}
