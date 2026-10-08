import {execFile} from 'node:child_process';
import {lstat, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {logger} from '@shipfox/node-opentelemetry';

const execFileAsync = promisify(execFile);

/**
 * Takes back the files a process in the job container left in `dir`. A container user that is not
 * the runner user owns what it created, and the runner can then neither read nor delete it.
 * Passwordless `sudo`, which the runner images grant, fixes that. Without it the files stay for
 * the removal at the end of the job.
 */
export async function reclaimAgentState(dir: string): Promise<void> {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || gid === undefined) return;
  try {
    if (!(await hasFilesOwnedByOthers(dir, uid))) return;
    await execFileAsync('sudo', ['-n', 'chown', '-R', `${uid}:${gid}`, '--', dir]);
  } catch (err) {
    logger().warn({err, dir}, 'Failed to reclaim agent state from the job container');
  }
}

async function hasFilesOwnedByOthers(dir: string, uid: number): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    return true;
  }
  for (const name of entries) {
    const path = join(dir, name);
    const stats = await lstat(path);
    if (stats.uid !== uid) return true;
    if (stats.isDirectory() && (await hasFilesOwnedByOthers(path, uid))) return true;
  }
  return false;
}
