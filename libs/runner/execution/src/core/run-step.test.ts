import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join} from 'node:path';
import type {StepDto} from '@shipfox/api-workflows-dto';
import {type CommandStartMetadata, executeRunStep, type OutputSink} from '#core/run-step.js';

const GRANDCHILD_PID_REGEX = /GRANDCHILD_PID=(\d+)/;
const ESRCH_REGEX = /ESRCH/;
const SHELL_EXECUTABLE_REGEX = /^(bash|sh)$/;
const SCRIPT_PATH_REGEX = /shipfox-runner-.*\.sh$/;

function collectOutput(): {sink: OutputSink; text: () => string; sources: () => string[]} {
  const chunks: Buffer[] = [];
  const sources: string[] = [];
  return {
    sink: (chunk, source) => {
      chunks.push(chunk);
      sources.push(source);
    },
    text: () => Buffer.concat(chunks).toString(),
    sources: () => sources,
  };
}

describe('executeRunStep', () => {
  it('succeeds with exit code 0', async () => {
    const step = buildStep({config: {run: 'echo hello'}});
    const output = collectOutput();

    const result = await executeRunStep(step, {onOutput: output.sink});

    expect(result.success).toBe(true);
    expect(output.text()).toContain('hello');
    expect(result.exit_code).toBe(0);
  });

  it('fails with non-zero exit code and reports it on result.error', async () => {
    const step = buildStep({config: {run: 'exit 1'}});

    const result = await executeRunStep(step);

    expect(result.success).toBe(false);
    expect(result.error).toEqual({message: 'Command exited with code 1', exit_code: 1});
    expect(result.exit_code).toBe(1);
  });

  it('captures both stdout and stderr with their origin', async () => {
    const step = buildStep({config: {run: 'echo out && echo err >&2'}});
    const output = collectOutput();

    const result = await executeRunStep(step, {onOutput: output.sink});

    expect(result.success).toBe(true);
    expect(output.text()).toContain('out');
    expect(output.text()).toContain('err');
    expect(output.sources()).toContain('stdout');
    expect(output.sources()).toContain('stderr');
  });

  it('returns failure for unsupported step type with the reason on error.message', async () => {
    const step = buildStep({type: 'docker', config: {image: 'node:20'}});
    const output = collectOutput();

    const result = await executeRunStep(step, {onOutput: output.sink});

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Unsupported step type: docker');
    expect(result.error?.exit_code).toBeUndefined();
    expect(output.text()).toBe('');
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
      const output = collectOutput();

      const result = await executeRunStep(step, {cwd: dir, onOutput: output.sink});

      expect(result.success).toBe(true);
      // macOS resolves tmpdir() through a /private symlink, so match the unique
      // mkdtemp suffix rather than the full path.
      expect(output.text()).toContain(basename(dir));
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });

  it('emits resolved command metadata before stdout or stderr', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shipfox-command-metadata-test-'));
    try {
      const step = buildStep({config: {run: 'echo hello'}});
      const events: string[] = [];
      let metadata: CommandStartMetadata | undefined;

      const result = await executeRunStep(step, {
        cwd: dir,
        onCommandStart: (value) => {
          events.push('metadata');
          metadata = value;
        },
        onOutput: () => {
          events.push('output');
        },
      });

      expect(result.success).toBe(true);
      expect(events[0]).toBe('metadata');
      expect(events).toContain('output');
      expect(metadata).toBeDefined();
      if (!metadata) throw new Error('expected command metadata');
      expect(metadata).toMatchObject({
        command: 'echo hello',
        cwd: dir,
      });
      expect(metadata.shell.executable).toMatch(SHELL_EXECUTABLE_REGEX);
      expect(metadata.shell.args.at(-1)).toMatch(SCRIPT_PATH_REGEX);
      expect(metadata.shell.display).toContain('{0}');
      expect(metadata.shell.display).not.toContain(metadata.shell.args.at(-1) ?? '');
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });

  it('continues running the command when command metadata emission throws', async () => {
    const step = buildStep({config: {run: 'echo still-runs'}});
    const output = collectOutput();

    const result = await executeRunStep(step, {
      onCommandStart: () => {
        throw new Error('capture unavailable');
      },
      onOutput: output.sink,
    });

    expect(result.success).toBe(true);
    expect(output.text()).toContain('still-runs');
  });

  it('handles multi-line scripts', async () => {
    const step = buildStep({
      config: {run: 'echo first\necho second'},
    });
    const output = collectOutput();

    const result = await executeRunStep(step, {onOutput: output.sink});

    expect(result.success).toBe(true);
    expect(output.text()).toContain('first');
    expect(output.text()).toContain('second');
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
    const output = collectOutput();
    const ac = new AbortController();
    const promise = executeRunStep(step, {signal: ac.signal, onOutput: output.sink});

    await new Promise((r) => setTimeout(r, 200));
    ac.abort();

    const result = await promise;
    expect(result.success).toBe(false);

    const match = output.text().match(GRANDCHILD_PID_REGEX);
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
  const name = overrides.name ?? 'test-step';
  return {
    id: '00000000-0000-0000-0000-000000000001',
    job_id: '00000000-0000-0000-0000-000000000002',
    name,
    display_name: name ?? 'test-step',
    source_location: null,
    status: 'running',
    type: overrides.type ?? 'run',
    config: overrides.config ?? {run: 'echo test'},
    error: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}
