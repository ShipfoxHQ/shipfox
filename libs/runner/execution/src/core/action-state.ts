import {MAX_STATE_BYTES} from '@shipfox/actions/contract';
import type {ExecutionHost} from '@shipfox/runner-container';
import type {StepResult} from '#core/step-result.js';

const STATE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const STATE_DROPPED = 'No state was kept for the post.';

export type ActionStateRead = {ok: true; content: string} | {ok: false; message: string};

/**
 * Reads the state file an action process left, one `{"name", "value"}` JSON line per entry. The
 * runner keeps the text as written, so a post starts from the same file.
 */
export async function readActionState(host: ExecutionHost, path: string): Promise<ActionStateRead> {
  let content: string;
  try {
    // One byte past the limit tells an oversized file from one that is exactly at it.
    const raw = await host.readFile(path, {length: MAX_STATE_BYTES + 1});
    if (raw.length > MAX_STATE_BYTES) {
      return {
        ok: false,
        message: `SHIPFOX_STATE exceeds the size limit of ${MAX_STATE_BYTES} bytes.`,
      };
    }
    content = raw.toString('utf8');
  } catch {
    return {ok: false, message: 'SHIPFOX_STATE could not be read.'};
  }
  return isValidState(content)
    ? {ok: true, content}
    : {ok: false, message: 'SHIPFOX_STATE is not a list of {"name", "value"} lines.'};
}

function isValidState(content: string): boolean {
  for (const line of content.split('\n')) {
    if (line === '') continue;
    try {
      const entry = JSON.parse(line) as {name?: unknown; value?: unknown};
      if (typeof entry.name !== 'string' || !STATE_NAME_RE.test(entry.name)) return false;
      if (typeof entry.value !== 'string') return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * A state file the action broke fails a step that otherwise succeeded. A step that already failed
 * keeps its own failure and gets a warning naming what was dropped.
 */
export function rejectActionState(result: StepResult, message: string): StepResult {
  if (!result.success) {
    return {...result, warnings: [...(result.warnings ?? []), `${message} ${STATE_DROPPED}`]};
  }
  return {...result, success: false, error: {message}, exit_code: null};
}
