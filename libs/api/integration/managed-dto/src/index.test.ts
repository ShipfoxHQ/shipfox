import {isManagedRepositoryId} from './index.js';

describe('isManagedRepositoryId', () => {
  it('accepts a managed id with a UUID', () => {
    const result = isManagedRepositoryId('managed:01890000-0000-7000-8000-000000000001');

    expect(result).toBe(true);
  });

  it.each([
    ['another provider', 'github:01890000-0000-7000-8000-000000000001'],
    ['a value that is not a UUID', 'managed:acme/config'],
    ['a missing value', 'managed:'],
    ['no provider', '01890000-0000-7000-8000-000000000001'],
  ])('rejects %s', (_, externalRepositoryId) => {
    const result = isManagedRepositoryId(externalRepositoryId);

    expect(result).toBe(false);
  });
});
