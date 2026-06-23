import {z} from 'zod';

export const LOG_STREAM_CLOSED = 'logs.stream.closed' as const;

export const logStreamClosedEventSchema = z.object({
  workspaceId: z.string(),
  jobId: z.string(),
  stepId: z.string(),
  attempt: z.number(),
  streamId: z.string(),
});
export type LogStreamClosedEvent = z.infer<typeof logStreamClosedEventSchema>;

export interface LogsEventMap {
  [LOG_STREAM_CLOSED]: LogStreamClosedEvent;
}

export const logsEventSchemas = {
  [LOG_STREAM_CLOSED]: logStreamClosedEventSchema,
} satisfies Record<keyof LogsEventMap, z.ZodType>;
