import {Buffer} from 'node:buffer';
import {z} from 'zod';

/**
 * NDJSON v1 log record contract — one JSON object per line, runner-framed.
 *
 * `offset` / `committed_length` are byte positions in the raw NDJSON spool stream
 * (envelope included) — the offset-CAS axis the runner tracks. The per-job accrual
 * budget charges those same raw stored bytes, so framing and control records count
 * against it too. The per-record byte caps below bound each record so a single
 * entry's overhead is known and a runner cannot grow storage without moving the
 * budget: `data` is non-empty and <= MAX_RECORD_DATA_BYTES, the group `name` is
 * <= MAX_RECORD_NAME_BYTES, and every other field is fixed-shape.
 */

/** Largest decoded `data` payload per record. Longer lines are split by the runner. */
export const MAX_RECORD_DATA_BYTES = 16 * 1024;

/** Largest `group_start` name. Bounds the only variable-length control field. */
export const MAX_RECORD_NAME_BYTES = 1024;

const baseRecordShape = {
  v: z.literal(1),
  /** Epoch milliseconds, assigned by the runner at capture. */
  ts: z.number().int().nonnegative(),
  src: z.enum(['stdout', 'stderr', 'system']).optional(),
};

export const outputRecordSchema = z.object({
  ...baseRecordShape,
  type: z.literal('output'),
  data: z
    .string()
    .min(1, {message: 'output data must not be empty'})
    .refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_RECORD_DATA_BYTES, {
      message: `data exceeds ${MAX_RECORD_DATA_BYTES} payload bytes`,
    }),
});

export const controlRecordSchema = z.discriminatedUnion('kind', [
  z.object({
    ...baseRecordShape,
    type: z.literal('control'),
    kind: z.literal('group_start'),
    name: z.string().refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_RECORD_NAME_BYTES, {
      message: `group name exceeds ${MAX_RECORD_NAME_BYTES} bytes`,
    }),
  }),
  z.object({...baseRecordShape, type: z.literal('control'), kind: z.literal('group_end')}),
  z.object({
    ...baseRecordShape,
    type: z.literal('control'),
    kind: z.literal('end'),
    total_bytes: z.number().int().nonnegative(),
  }),
  z.object({...baseRecordShape, type: z.literal('control'), kind: z.literal('capped')}),
  z.object({
    ...baseRecordShape,
    type: z.literal('control'),
    kind: z.literal('gap'),
    dropped_bytes: z.number().int().nonnegative(),
  }),
  z.object({...baseRecordShape, type: z.literal('control'), kind: z.literal('runner_lost')}),
]);

// Top-level is a plain union (not discriminated) because the two branches key
// on different discriminators: `output` on `type`, control on `kind`.
export const logRecordSchema = z.union([outputRecordSchema, controlRecordSchema]);

export type OutputRecord = z.infer<typeof outputRecordSchema>;
export type ControlRecord = z.infer<typeof controlRecordSchema>;
export type LogRecord = z.infer<typeof logRecordSchema>;

/** Parses and validates one NDJSON line. Throws on invalid JSON or a record that fails the v1 contract. */
export function parseLogRecordLine(line: string): LogRecord {
  return logRecordSchema.parse(JSON.parse(line));
}
