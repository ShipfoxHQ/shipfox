import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {StepResult} from '#core/step-result.js';

const CGROUP_ROOT = '/sys/fs/cgroup';
const OOM_KILL_LINE_REGEX = /^oom_kill (\d+)$/m;
const CGROUP_V2_LINE_REGEX = /^0::(\/.*)$/m;

/**
 * Locates the cgroup v2 `memory.events` file of the runner's own cgroup, which step
 * processes share. Returns undefined off Linux or on cgroup v1 hosts.
 */
export async function resolveCgroupMemoryEventsPath(): Promise<string | undefined> {
  let membership: string;
  try {
    membership = await readFile('/proc/self/cgroup', 'utf8');
  } catch {
    return undefined;
  }
  const cgroup = membership.match(CGROUP_V2_LINE_REGEX)?.[1];
  if (cgroup === undefined) return undefined;
  return join(CGROUP_ROOT, cgroup, 'memory.events');
}

export async function readOomKillCount(memoryEventsPath: string): Promise<number | undefined> {
  try {
    const events = await readFile(memoryEventsPath, 'utf8');
    const count = events.match(OOM_KILL_LINE_REGEX)?.[1];
    return count === undefined ? undefined : Number(count);
  } catch {
    return undefined;
  }
}

const OUT_OF_MEMORY_MESSAGE = /out of memory/iu;

/**
 * Runs a step and reports the processes the system killed for memory while it ran. The kill
 * often hits a descendant, so the step can fail with an ordinary exit code or still succeed.
 * The counter belongs to the whole runner, so it also counts kills in a step running alongside.
 */
export async function reportOutOfMemoryKills(params: {
  memoryEventsPath: string | undefined;
  annotationContext: string;
  signal?: AbortSignal;
  run: () => Promise<StepResult>;
}): Promise<StepResult> {
  const {memoryEventsPath} = params;
  if (memoryEventsPath === undefined) return await params.run();
  const before = await readOomKillCount(memoryEventsPath);
  const result = await params.run();
  if (before === undefined || params.signal?.aborted) return result;
  const after = await readOomKillCount(memoryEventsPath);
  if (after === undefined || after <= before) return result;

  const killed = after - before;
  const processes = killed === 1 ? '1 process' : `${killed} processes`;
  const advice = 'Reduce the memory the step uses or run it on a runner with more memory.';
  const report = `The runner ran out of memory during this step and the system killed ${processes}.`;
  if (result.success || result.error === null || result.error === undefined) {
    return {
      ...result,
      annotations: [
        ...(result.annotations ?? []),
        {
          op: 'replace',
          context: params.annotationContext,
          style: 'warning',
          body: `${report} The step still finished. ${advice}`,
        },
      ],
    };
  }
  if (OUT_OF_MEMORY_MESSAGE.test(result.error.message)) return result;
  return {
    ...result,
    error: {
      ...result.error,
      // The report comes first so the length limit on a reported message cannot cut it off.
      message: `${report} ${advice} ${result.error.message}`,
    },
  };
}
