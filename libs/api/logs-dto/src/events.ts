import {z} from 'zod';

const nonEmptyStringSchema = z.string().nonempty();

export const LOG_STREAM_CLOSED = 'logs.stream.closed' as const;

export const logStreamClosedEventSchema = z.object({
  workspaceId: nonEmptyStringSchema,
  jobId: nonEmptyStringSchema,
  stepId: nonEmptyStringSchema,
  attempt: z.number(),
  streamId: nonEmptyStringSchema,
});
export type LogStreamClosedEvent = z.infer<typeof logStreamClosedEventSchema>;

export interface LogsEventMap {
  [LOG_STREAM_CLOSED]: LogStreamClosedEvent;
}

export const logsEventSchemas = {
  [LOG_STREAM_CLOSED]: logStreamClosedEventSchema,
} satisfies Record<keyof LogsEventMap, z.ZodType>;
