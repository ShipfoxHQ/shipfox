import {STORE_KEY_HELP, validateNewStoreKey, validateStoreKey} from './store-key.js';

describe('validateStoreKey', () => {
  test('accepts a valid uppercase identifier', () => {
    expect(validateStoreKey('MY_TOKEN')).toBeUndefined();
  });

  test('rejects a malformed key', () => {
    expect(validateStoreKey('my token')).toBe(STORE_KEY_HELP);
  });
});

describe('validateNewStoreKey', () => {
  test('blocks a create that collides with an existing key', () => {
    const error = validateNewStoreKey('API_TOKEN', {
      mode: 'create',
      reservedKeys: ['API_TOKEN', 'DATABASE_URL'],
      kind: 'secret',
    });

    expect(error).toBe('A secret with this name already exists. Edit it instead.');
  });

  test('allows a create with a fresh key', () => {
    const error = validateNewStoreKey('NEW_KEY', {
      mode: 'create',
      reservedKeys: ['API_TOKEN'],
      kind: 'secret',
    });

    expect(error).toBeUndefined();
  });

  test('does not treat the locked key as a collision in edit mode', () => {
    const error = validateNewStoreKey('LOG_LEVEL', {
      mode: 'edit',
      reservedKeys: ['LOG_LEVEL'],
      kind: 'variable',
    });

    expect(error).toBeUndefined();
  });

  test('enforces the format before the collision check', () => {
    const error = validateNewStoreKey('bad key', {
      mode: 'create',
      reservedKeys: [],
      kind: 'secret',
    });

    expect(error).toBe(STORE_KEY_HELP);
  });
});
