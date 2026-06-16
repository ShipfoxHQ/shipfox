import {z} from 'zod';

/**
 * Append endpoint contract: `POST .../steps/:stepId/logs?attempt=N&offset=B`.
 *
 * The body is raw NDJSON bytes (whole records, newline-terminated), not a
 * Zod-validated object — it is parsed line by line with `logRecordSchema`.
 * `offset` is a position in the raw NDJSON spool stream; both `offset` and the
 * returned `committed_length` are bounded far below 2^53 by the accrual budget,
 * so JavaScript `number` is safe.
 */
export const appendLogsQuerySchema = z.object({
  attempt: z.coerce.number().int().min(1),
  offset: z.coerce.number().int().min(0),
});

export type AppendLogsQueryDto = z.infer<typeof appendLogsQuerySchema>;

export const appendLogsResponseSchema = z.object({
  committed_length: z.number().int().min(0),
  capped: z.boolean(),
});

export type AppendLogsResponseDto = z.infer<typeof appendLogsResponseSchema>;

/** Body of the 409 returned on an offset gap, so the runner rewinds its spool cursor. */
export const offsetGapResponseSchema = z.object({
  committed_length: z.number().int().min(0),
});

export type OffsetGapResponseDto = z.infer<typeof offsetGapResponseSchema>;
