import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

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
