import crypto from 'node:crypto';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {DekUnwrapError} from './errors.js';
import {createLocalKeyProvider} from './key-provider.js';

describe('local key provider', () => {
  it('wraps with the current KEK and unwraps with current or previous KEK', () => {
    const currentKek = crypto.randomBytes(32);
    const previousKek = crypto.randomBytes(32);
    const provider = createLocalKeyProvider({currentKek, previousKek});
    const previousProvider = createLocalKeyProvider({currentKek: previousKek});
    const workspaceId = crypto.randomUUID();
    const dek = crypto.randomBytes(32);

    const previousWrapped = previousProvider.wrapDek(workspaceId, dek);
    const unwrappedPrevious = provider.unwrapDek(
      workspaceId,
      previousWrapped.wrappedDek,
      previousWrapped.kekVersion,
    );
    const currentWrapped = provider.wrapDek(workspaceId, unwrappedPrevious);
    const unwrappedCurrent = provider.unwrapDek(
      workspaceId,
      currentWrapped.wrappedDek,
      currentWrapped.kekVersion,
    );

    expect(currentWrapped.kekVersion).toBe(provider.currentKeyVersion);
    expect(previousWrapped.kekVersion).toBe(provider.previousKeyVersion);
    expect(unwrappedCurrent.equals(dek)).toBe(true);
  });

  it('rejects unknown versions and wrong workspace AAD', () => {
    const provider = createLocalKeyProvider({currentKek: crypto.randomBytes(32)});
    const wrapped = provider.wrapDek(crypto.randomUUID(), crypto.randomBytes(32));

    expect(() =>
      provider.unwrapDek(crypto.randomUUID(), wrapped.wrappedDek, wrapped.kekVersion),
    ).toThrow(DekUnwrapError);
    expect(() =>
      provider.unwrapDek(crypto.randomUUID(), wrapped.wrappedDek, 'local:unknown'),
    ).toThrow(DekUnwrapError);
  });
});
