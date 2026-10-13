import {z} from 'zod';
import {
  inferenceSegmentUsageSchema,
  recordedJobExecutionUsageSchema,
  storageSampleUsageSchema,
} from './schemas/usage.js';

export const USAGE_JOB_EXECUTION_RECORDED = 'usage.job_execution.recorded' as const;
export const USAGE_INFERENCE_SEGMENT_RECORDED = 'usage.inference_segment.recorded' as const;
export const USAGE_STORAGE_SAMPLE_RECORDED = 'usage.storage_sample.recorded' as const;

export const usageJobExecutionRecordedEventSchema = recordedJobExecutionUsageSchema;
export type UsageJobExecutionRecordedEvent = z.infer<typeof usageJobExecutionRecordedEventSchema>;

export const usageInferenceSegmentRecordedEventSchema = inferenceSegmentUsageSchema
  .extend({version: z.literal(1)})
  .strict();
export type UsageInferenceSegmentRecordedEvent = z.infer<
  typeof usageInferenceSegmentRecordedEventSchema
>;

export const usageStorageSampleRecordedEventSchema = storageSampleUsageSchema
  .extend({version: z.literal(1)})
  .strict();
export type UsageStorageSampleRecordedEvent = z.infer<typeof usageStorageSampleRecordedEventSchema>;

export interface UsageEventMap {
  [USAGE_JOB_EXECUTION_RECORDED]: UsageJobExecutionRecordedEvent;
  [USAGE_INFERENCE_SEGMENT_RECORDED]: UsageInferenceSegmentRecordedEvent;
  [USAGE_STORAGE_SAMPLE_RECORDED]: UsageStorageSampleRecordedEvent;
}

export const usageEventSchemas = {
  [USAGE_JOB_EXECUTION_RECORDED]: usageJobExecutionRecordedEventSchema,
  [USAGE_INFERENCE_SEGMENT_RECORDED]: usageInferenceSegmentRecordedEventSchema,
  [USAGE_STORAGE_SAMPLE_RECORDED]: usageStorageSampleRecordedEventSchema,
} satisfies Record<keyof UsageEventMap, z.ZodType>;
