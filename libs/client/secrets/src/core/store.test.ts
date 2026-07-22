import {
  normalizeStoreKey,
  STORE_KEY_HELP,
  shouldWarnSensitiveVariableName,
  shouldWarnShortSecretValue,
  validateNewStoreKey,
  validateStoreKey,
} from './store.js';

describe('store policy', () => {
  test('normalizes keys and enforces the store key format', () => {
    expect(normalizeStoreKey('my_token')).toBe('MY_TOKEN');
    expect(validateStoreKey('MY_TOKEN')).toBeUndefined();
    expect(validateStoreKey('my token')).toBe(STORE_KEY_HELP);
  });

  test('prevents create mode from overwriting an existing write-only secret', () => {
    expect(
      validateNewStoreKey('API_TOKEN', {
        mode: 'create',
        reservedKeys: ['API_TOKEN'],
        kind: 'secret',
      }),
    ).toBe('A secret with this name already exists. Edit it instead.');
  });

  test('keeps edit mode and warning interpretation explicit', () => {
    expect(
      validateNewStoreKey('API_TOKEN', {
        mode: 'edit',
        reservedKeys: ['API_TOKEN'],
        kind: 'secret',
      }),
    ).toBeUndefined();
    expect(shouldWarnShortSecretValue('short', 12)).toBe(true);
    expect(shouldWarnSensitiveVariableName('API_TOKEN')).toBe(true);
  });
});
