import {closeStream} from '#core/close-stream.js';
import {db} from '#db/db.js';
import {listOpenStreamsByJob} from '#db/streams.js';

/**
 * Force-closes every stream still open for a terminated job: the runner died, was
 * capped, or its spool failed, so it never sent an end record. Each stream closes in
 * its own transaction through the guarded `closeStream`, so one that the declared
 * path closed in the meantime is skipped (returns null). `closeStream` marks the
 * stream `truncated` and injects a `runner_lost` tombstone.
 */
export async function closeAbandonedStreamsActivity(params: {
  jobId: string;
}): Promise<{closed: number}> {
  const open = await listOpenStreamsByJob(params.jobId);

  let closed = 0;
  for (const stream of open) {
    const result = await db().transaction((tx) =>
      closeStream(tx, {streamId: stream.id, reason: 'timeout'}),
    );
    if (result) closed += 1;
  }

  return {closed};
}
