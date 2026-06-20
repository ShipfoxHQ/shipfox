import {Buffer} from 'node:buffer';
import {z} from 'zod';

/**
 * NDJSON log record contract — one JSON object per line, runner-framed.
 *
 * `offset` / `committed_length` are byte positions in the raw NDJSON spool stream
 * (envelope included) — the offset-CAS axis the runner tracks. The per-job accrual
 * budget charges those same raw stored bytes, so framing and control records count
 * against it too. The per-record byte caps below bound each record so a single
 * entry's overhead is known and a runner cannot grow storage without moving the
 * budget: `data` is non-empty and <= MAX_RECORD_DATA_BYTES, the group `name` is
 * <= MAX_RECORD_NAME_BYTES, the group ids are <= MAX_RECORD_GROUP_ID_BYTES, and every
 * other field is fixed-shape.
 *
 * The envelope is `{v, ts}`, and every record is discriminated by a single flat
 * `type`. The ingest (appendable) and read unions are distinct types: the server-only
 * `capped` / `runner_lost` tombstones are members of the read union only, so a forged
 * tombstone cannot pass append validation.
 */

/** Largest decoded `data` payload per record. Longer lines are split by the runner. */
export const MAX_RECORD_DATA_BYTES = 16 * 1024;

/** Largest `group_start` name. Bounds the only variable-length control field. */
export const MAX_RECORD_NAME_BYTES = 1024;

/**
 * Largest `group_id` / `parent_group_id`. The runner emits short monotonic ids (`g1`,
 * `g2`, …); this only bounds a forged id from a lease-scoped writer so the ids stay a
 * fixed-shape field like every other record field.
 */
export const MAX_RECORD_GROUP_ID_BYTES = 256;

const groupId = z
  .string()
  .min(1, {message: 'group id must not be empty'})
  .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_RECORD_GROUP_ID_BYTES, {
    message: `group id exceeds ${MAX_RECORD_GROUP_ID_BYTES} bytes`,
  });

const envelope = {
  v: z.literal(1),
  /** Epoch milliseconds, assigned by the runner at capture. */
  ts: z.number().int().nonnegative(),
};

const logOutput = z.object({
  ...envelope,
  type: z.literal('output'),
  stream: z.enum(['stdout', 'stderr']),
  data: z
    .string()
    .min(1, {message: 'output data must not be empty'})
    .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_RECORD_DATA_BYTES, {
      message: `data exceeds ${MAX_RECORD_DATA_BYTES} payload bytes`,
    }),
});

const logGroupStart = z.object({
  ...envelope,
  type: z.literal('group_start'),
  group_id: groupId,
  parent_group_id: groupId.nullable(),
  name: z.string().refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_RECORD_NAME_BYTES, {
    message: `group name exceeds ${MAX_RECORD_NAME_BYTES} bytes`,
  }),
});

const logGroupEnd = z.object({...envelope, type: z.literal('group_end'), group_id: groupId});

const logEnd = z.object({
  ...envelope,
  type: z.literal('end'),
  total_bytes: z.number().int().nonnegative(),
});

const logGap = z.object({
  ...envelope,
  type: z.literal('gap'),
  dropped_bytes: z.number().int().nonnegative(),
});

// Server-only tombstones: NOT members of the appendable union.
const logCapped = z.object({...envelope, type: z.literal('capped')});
const logRunnerLost = z.object({...envelope, type: z.literal('runner_lost')});

/** Records a lease-scoped runner may append. The write path validates against this. */
export const appendableLogRecordSchema = z.discriminatedUnion('type', [
  logOutput,
  logGroupStart,
  logGroupEnd,
  logEnd,
  logGap,
]);

/** Full read union: appendable records plus the server-only tombstones. */
export const logRecordSchema = z.discriminatedUnion('type', [
  logOutput,
  logGroupStart,
  logGroupEnd,
  logEnd,
  logGap,
  logCapped,
  logRunnerLost,
]);

export type AppendableLogRecord = z.infer<typeof appendableLogRecordSchema>;
export type LogRecord = z.infer<typeof logRecordSchema>;

/** Parses one NDJSON line against the full read union. Throws on invalid JSON or an unknown record. */
export function parseLogRecordLine(line: string): LogRecord {
  return logRecordSchema.parse(JSON.parse(line));
}

/**
 * Parses one NDJSON line against the appendable union (the write path). A forged
 * server-only `capped` / `runner_lost` record fails here even though it is valid
 * under the read union — this is the write-path forgery guard.
 */
export function parseAppendableLogRecordLine(line: string): AppendableLogRecord {
  return appendableLogRecordSchema.parse(JSON.parse(line));
}
