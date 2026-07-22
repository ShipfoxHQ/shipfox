import {secret, variable, variableListItem} from '#test/fixtures/secrets.js';
import {
  toSecretMetadata,
  toStoreWriteWarnings,
  toVariable,
  toVariablePreview,
} from './store-mapper.js';

describe('store transport mapping', () => {
  test('maps secret metadata and workspace scope into a package-owned model', () => {
    expect(toSecretMetadata(secret())).toEqual({
      key: 'MY_TOKEN',
      scope: {kind: 'workspace'},
      createdAt: '2026-05-08T00:00:00.000Z',
      updatedAt: '2026-05-08T00:00:00.000Z',
      lastEditedBy: '22222222-2222-4222-8222-222222222222',
    });
  });

  test('keeps truncated list values distinct from full detail values', () => {
    expect(
      toVariablePreview(variableListItem({value: 'preview', value_truncated: true})),
    ).toMatchObject({
      value: 'preview',
      valueState: 'preview',
      valueTruncated: true,
    });
    expect(toVariable(variable({value: 'complete value'}))).toMatchObject({
      value: 'complete value',
      valueState: 'full',
    });
  });

  test('maps server warning DTOs to the store warning model', () => {
    expect(toStoreWriteWarnings([{code: 'short-secret-value', key: 'MY_TOKEN'}])).toEqual([
      {code: 'short-secret-value', key: 'MY_TOKEN'},
    ]);
  });
});
