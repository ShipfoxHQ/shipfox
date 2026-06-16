import {Buffer} from 'node:buffer';
import {z} from 'zod';

/**
 * NDJSON v1 log record contract — one JSON object per line, runner-framed.
 *
 * Two byte axes, kept distinct on purpose (a server and runner that conflate
 * them will disagree forever):
 *
 *   - offset / committed_length  → byte positions in the RAW NDJSON spool stream
 *     (envelope included). This is the offset-CAS axis the runner tracks.
 *   - budget payload bytes        → decoded `data` UTF-8 bytes of `output` records
 *     only (envelope and control records excluded). This is the accrual-budget axis.
 */

/** Largest decoded `data` payload per record. Longer lines are split by the runner. */
export const MAX_RECORD_DATA_BYTES = 16 * 1024;

const baseRecordShape = {
  v: z.literal(1),
  /** Epoch milliseconds, assigned by the runner at capture. */
  ts: z.number().int().nonnegative(),
  src: z.enum(['stdout', 'stderr', 'system']).optional(),
};

export const outputRecordSchema = z.object({
  ...baseRecordShape,
  type: z.literal('output'),
  data: z.string().refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_RECORD_DATA_BYTES, {
    message: `data exceeds ${MAX_RECORD_DATA_BYTES} payload bytes`,
  }),
});

export const controlRecordSchema = z.discriminatedUnion('kind', [
  z.object({
    ...baseRecordShape,
    type: z.literal('control'),
    kind: z.literal('group_start'),
    name: z.string(),
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
