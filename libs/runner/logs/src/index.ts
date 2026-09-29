export type {OutputSource, ToolLogRow} from '#core/framing.js';
export type {LogDrainOutcome, LogStreamLifecycle} from '#core/lifecycle.js';
export {buildSecretVariants} from '#core/secrets.js';
export {
  createSessionLogStream,
  type SessionLogStream,
  type SessionLogStreamOptions,
} from '#core/session-log-stream.js';
export {maskSessionTranscript} from '#core/session-transcript.js';
export {
  createStepLogStream,
  type StepLogGroupOptions,
  type StepLogStream,
  type StepLogStreamOptions,
} from '#core/step-log-stream.js';
export {
  createTextLogSink,
  TEXT_LOG_MAX_BYTES,
  TEXT_LOG_SEGMENT_BYTES,
  type TextLogSink,
  type TextLogSinkOptions,
} from '#core/text-sink.js';
export type {TransformEvent} from '#core/transform.js';
