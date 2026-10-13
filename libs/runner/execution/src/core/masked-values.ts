import {MIN_MASKED_VALUE_LENGTH} from '@shipfox/actions/contract';
import {StepOutputError} from '#core/step-output.js';

const LINE_SPLIT_REGEX = /\r?\n/;

export interface ParsedMaskedValues {
  readonly values: string[];
  /** Set when a line is too short. The other lines are still returned, so they stay masked. */
  readonly error?: StepOutputError;
}

/**
 * Reads `$SHIPFOX_MASK`: one value per line. A short value would also hide ordinary text in the
 * logs of every later step, so it fails the step. The message never quotes the value.
 */
export function parseMaskedValues(raw: string): ParsedMaskedValues {
  const values = new Set<string>();
  let error: StepOutputError | undefined;
  for (const [index, line] of raw.split(LINE_SPLIT_REGEX).entries()) {
    if (line.trim() === '') continue;
    if ([...line].length >= MIN_MASKED_VALUE_LENGTH) {
      values.add(line);
      continue;
    }
    error ??= new StepOutputError(
      `Mask file line ${index + 1} is shorter than ${MIN_MASKED_VALUE_LENGTH} characters.`,
    );
  }
  return {values: [...values], ...(error ? {error} : {})};
}
