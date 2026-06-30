import {fieldError} from './form-field.js';

function makeField(errors: unknown[], isBlurred: boolean) {
  return {state: {meta: {errors, isBlurred}}};
}

describe('fieldError', () => {
  test('returns undefined when there are no errors and the field is not blurred', () => {
    const field = makeField([], false);

    const result = fieldError(field);

    expect(result).toBeUndefined();
  });

  test('returns undefined when blurred with no errors', () => {
    const field = makeField([], true);

    const result = fieldError(field);

    expect(result).toBeUndefined();
  });

  test('returns a string error after blur', () => {
    const field = makeField(['Too short'], true);

    const result = fieldError(field);

    expect(result).toBe('Too short');
  });

  test('returns a string error from submit validation before blur', () => {
    const field = makeField(['Required'], false);

    const result = fieldError(field);

    expect(result).toBe('Required');
  });

  test('extracts the message from a Zod-style error object', () => {
    const field = makeField([{message: 'Invalid email', code: 'invalid_string'}], true);

    const result = fieldError(field);

    expect(result).toBe('Invalid email');
  });

  test('returns undefined for an object error without a message property', () => {
    const field = makeField([{code: 'unknown'}], true);

    const result = fieldError(field);

    expect(result).toBeUndefined();
  });

  test('returns undefined when the first error is null', () => {
    const field = makeField([null], true);

    const result = fieldError(field);

    expect(result).toBeUndefined();
  });

  test('returns only the first error when multiple are present', () => {
    const field = makeField(['First', 'Second'], true);

    const result = fieldError(field);

    expect(result).toBe('First');
  });
});
