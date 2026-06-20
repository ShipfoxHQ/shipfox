import {MAX_RECORD_DATA_BYTES} from '@shipfox/api-logs-dto';
import {createConfig, num} from '@shipfox/config';

// The uploader's flush window must hold at least one whole encoded NDJSON record, or
// spool.read returns a torn (non-newline-terminated) line the server rejects with 400 on
// every flush. A record's `data` is capped at MAX_RECORD_DATA_BYTES decoded bytes, but
// JSON-escaping can inflate it ~6x (every byte a `\uXXXX` control char), so the floor clears
// that worst case plus envelope headroom.
const MIN_FLUSH_BYTES = MAX_RECORD_DATA_BYTES * 6 + 1024;
// The server's /logs route enforces a configurable body limit (LOG_APPEND_BODY_LIMIT_BYTES,
// default 1 MiB) that the runner cannot read. Cap the flush window at that same 1 MiB: the
// default flush (256 KiB) leaves ample headroom, but at this max it only equals the server
// default, with no slack. A body over the server limit 413s, which the uploader treats as
// terminal (permanent log loss for the attempt), so a self-host that lowers the server limit
// must lower SHIPFOX_LOG_FLUSH_BYTES below it too.
const MAX_FLUSH_BYTES = 1024 * 1024;

export const config = createConfig({
  SHIPFOX_LOG_FLUSH_INTERVAL_MS: num({
    desc: 'How often the runner uploads buffered step logs, in milliseconds. This bounds how much recent output is lost if the runner machine dies mid-step.',
    default: 2000,
  }),
  SHIPFOX_LOG_FLUSH_BYTES: num({
    desc: `Size threshold in bytes that triggers an early log upload before the interval elapses, so bursts of output do not wait for the timer. Must be between ${MIN_FLUSH_BYTES} and ${MAX_FLUSH_BYTES}: a smaller window cannot hold one whole log record, and a larger one risks exceeding the server's request body limit.`,
    default: 262144,
  }),
  SHIPFOX_LOG_SPOOL_MAX_BYTES: num({
    desc: 'Maximum number of not-yet-acknowledged log bytes the runner keeps on disk per step attempt. When the API is unreachable and this backlog is exceeded, further output is dropped and a gap marker is recorded instead of filling the disk.',
    default: 67108864,
  }),
  SHIPFOX_LOG_DRAIN_TIMEOUT_MS: num({
    desc: 'How long, in milliseconds, the runner waits at the end of a job for in-flight log uploads to finish before deleting the workspace. Bounds shutdown when the API is slow or unreachable.',
    default: 5000,
  }),
});

// envalid's num has no range support, so enforce the flush-window bounds here: an out-of-range
// value would otherwise either tear every record (too small) or 413 on every flush (too large),
// silently stalling log delivery. Fail fast at startup instead, like the rest of config.
if (
  config.SHIPFOX_LOG_FLUSH_BYTES < MIN_FLUSH_BYTES ||
  config.SHIPFOX_LOG_FLUSH_BYTES > MAX_FLUSH_BYTES
) {
  throw new Error(
    `SHIPFOX_LOG_FLUSH_BYTES must be between ${MIN_FLUSH_BYTES} and ${MAX_FLUSH_BYTES} bytes; got ${config.SHIPFOX_LOG_FLUSH_BYTES}.`,
  );
}
