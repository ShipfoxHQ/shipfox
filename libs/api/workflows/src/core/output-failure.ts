import {
  InterpolationUnresolvableError,
  type InterpolationUnresolvableField,
  JobOutputNotJsonSafeError,
  JobOutputTooLargeError,
  JobOutputTooManyEntriesError,
} from './errors.js';

const MAX_STATUS_REASON_MESSAGE_LENGTH = 2048;

export type OutputFailure = {
  statusReason: 'output_invalid' | 'output_too_large';
  statusReasonMessage: string;
};

/**
 * Maps an output materialization error to the status reason that fails the
 * execution or run attempt. Anything else is unexpected and returns null.
 */
export function classifyOutputFailure(
  error: unknown,
  field: Extract<
    InterpolationUnresolvableField,
    'job.outputs' | 'workflow.outputs'
  > = 'job.outputs',
): OutputFailure | null {
  if (error instanceof JobOutputTooLargeError) {
    return {
      statusReason: 'output_too_large',
      statusReasonMessage: boundedStatusReasonMessage(error.message),
    };
  }

  if (
    (error instanceof InterpolationUnresolvableError && error.field === field) ||
    error instanceof JobOutputNotJsonSafeError ||
    error instanceof JobOutputTooManyEntriesError
  ) {
    return {
      statusReason: 'output_invalid',
      statusReasonMessage: boundedStatusReasonMessage(error.message),
    };
  }

  return null;
}

function boundedStatusReasonMessage(message: string): string {
  return message.length <= MAX_STATUS_REASON_MESSAGE_LENGTH
    ? message
    : `${message.slice(0, MAX_STATUS_REASON_MESSAGE_LENGTH - 1)}…`;
}
