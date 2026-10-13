import {MIN_MASKED_VALUE_LENGTH} from '@shipfox/actions/contract';
import {StepOutputError} from '#core/step-output.js';

const LINE_SPLIT_REGEX = /\r?\n/;

/**
 * Reads `$SHIPFOX_MASK`: one value per line. A short value would also hide ordinary text in the
 * logs of every later step, so it fails the step. The message never quotes the value.
 */
export function parseMaskedValues(raw: string): string[] {
  const values = new Set<string>();
  for (const [index, line] of raw.split(LINE_SPLIT_REGEX).entries()) {
    if (line.trim() === '') continue;
    if ([...line].length < MIN_MASKED_VALUE_LENGTH) {
      throw new StepOutputError(
        `Mask file line ${index + 1} is shorter than ${MIN_MASKED_VALUE_LENGTH} characters.`,
      );
    }
    values.add(line);
  }
  return [...values];
}
