import crypto from 'node:crypto';
import {aadForDek, aesGcmOpen, aesGcmSeal} from './crypto.js';
import {DekUnwrapError, DekWrapError} from './errors.js';

const KEK_VERSION_DOMAIN = 'shipfox-secrets-kek-version';

export interface WrappedDek {
  wrappedDek: string;
  kekVersion: string;
}

export interface KeyProvider {
  readonly currentKeyVersion: string;
  readonly previousKeyVersion: string | null;
  wrapDek(workspaceId: string, plaintextDek: Buffer): WrappedDek;
  unwrapDek(workspaceId: string, wrappedDek: string, kekVersion: string): Buffer;
}

export interface LocalKeyProviderParams {
  currentKek: Buffer;
  previousKek?: Buffer | undefined;
}

export function createLocalKeyProvider(params: LocalKeyProviderParams): KeyProvider {
  const currentKeyVersion = deriveLocalKekVersion(params.currentKek);
  const previousKeyVersion = params.previousKek ? deriveLocalKekVersion(params.previousKek) : null;

  return {
    currentKeyVersion,
    previousKeyVersion,
    wrapDek(workspaceId, plaintextDek) {
      try {
        return {
          wrappedDek: aesGcmSeal({
            key: params.currentKek,
            plaintext: plaintextDek,
            aad: aadForDek(workspaceId, currentKeyVersion),
          }),
          kekVersion: currentKeyVersion,
        };
      } catch {
        throw new DekWrapError();
      }
    },
    unwrapDek(workspaceId, wrappedDek, kekVersion) {
      const key =
        kekVersion === currentKeyVersion
          ? params.currentKek
          : kekVersion === previousKeyVersion
            ? params.previousKek
            : undefined;
      if (!key) throw new DekUnwrapError();

      try {
        return aesGcmOpen({
          key,
          encoded: wrappedDek,
          aad: aadForDek(workspaceId, kekVersion),
        });
      } catch {
        throw new DekUnwrapError();
      }
    },
  };
}

export function deriveLocalKekVersion(kek: Buffer): string {
  const hash = crypto.createHash('sha256').update(KEK_VERSION_DOMAIN).update(kek).digest('hex');
  return `local:${hash.slice(0, 16)}`;
}
