import {displayNameFieldError} from './display-name-field-error.js';

const DISPLAY_NAME_DISALLOWED_CHARACTER_RE = /[\p{Cc}\p{Cf}]/u;

const displayNameSchema = {
  safeParse(value: string) {
    const trimmed = value.trim();
    return {
      success:
        !DISPLAY_NAME_DISALLOWED_CHARACTER_RE.test(value) &&
        trimmed.length > 0 &&
        trimmed.length <= 255,
    };
  },
};

describe('displayNameFieldError', () => {
  test('returns undefined for valid names', () => {
    const result = displayNameFieldError('  Renée  ', 'Name', displayNameSchema);

    expect(result).toBeUndefined();
  });

  test('maps blank names to required copy', () => {
    const result = displayNameFieldError('  ', 'Project name', displayNameSchema);

    expect(result).toBe('Project name is required.');
  });

  test('maps disallowed hidden characters to hidden-character copy', () => {
    const result = displayNameFieldError('Bad\u202eName', 'Workspace name', displayNameSchema);

    expect(result).toBe(
      'Workspace name cannot include line breaks, tabs, or hidden formatting characters.',
    );
  });

  test('maps names over 255 trimmed characters to length copy', () => {
    const result = displayNameFieldError(` ${'a'.repeat(256)} `, 'Name', displayNameSchema);

    expect(result).toBe('Name must be 255 characters or fewer.');
  });
});
