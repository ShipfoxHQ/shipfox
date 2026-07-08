import crypto from 'node:crypto';
import {getDataKey, insertDataKeyIfAbsent} from '#db/index.js';
import {classifyDekAccessError, recordSecretsDekAccess} from '#metrics/instance.js';
import type {KeyProvider} from './key-provider.js';

const DEK_BYTES = 32;

/**
 * Plaintext DEKs live in memory by design so hot secret reads avoid unwrapping on
 * every access. Node cannot reliably zeroize Buffers, so residency is bounded by
 * LRU size and lazy TTL instead of pretending wipes are a complete mitigation.
 */
export class DekManager {
  readonly #cache = new Map<string, {dek: Buffer; expiresAt: number}>();
  readonly #keyProvider: KeyProvider;
  readonly #options: {maxEntries: number; ttlMs: number};

  constructor(keyProvider: KeyProvider, options: {maxEntries: number; ttlMs: number}) {
    this.#keyProvider = keyProvider;
    this.#options = options;
  }

  async getPlaintextDek(workspaceId: string): Promise<Buffer> {
    const startedAt = Date.now();
    try {
      const cached = this.#cache.get(workspaceId);
      if (cached && cached.expiresAt > Date.now()) {
        this.#cache.delete(workspaceId);
        this.#cache.set(workspaceId, cached);
        recordSecretsDekAccess({outcome: 'cache_hit', durationMs: Date.now() - startedAt});
        return Buffer.from(cached.dek);
      }
      const hadExpiredCache = Boolean(cached);
      if (cached) this.#cache.delete(workspaceId);

      const existing = await getDataKey(workspaceId);
      if (existing) {
        const dek = this.#keyProvider.unwrapDek(
          workspaceId,
          existing.wrappedDek,
          existing.kekVersion,
        );
        this.#set(workspaceId, dek);
        recordSecretsDekAccess({
          outcome: hadExpiredCache ? 'cache_expired' : 'db_unwrapped',
          durationMs: Date.now() - startedAt,
        });
        return Buffer.from(dek);
      }

      const generatedDek = crypto.randomBytes(DEK_BYTES);
      const wrapped = this.#keyProvider.wrapDek(workspaceId, generatedDek);
      const inserted = await insertDataKeyIfAbsent({
        workspaceId,
        wrappedDek: wrapped.wrappedDek,
        kekVersion: wrapped.kekVersion,
      });

      // The DEK row commits before value writes. If concurrent first-use inserts race,
      // the primary key decides the winner and every caller re-reads the persisted row.
      const persisted = await getDataKey(workspaceId);
      if (!persisted) throw new Error(`Data key was not persisted for workspace ${workspaceId}`);
      const dek = this.#keyProvider.unwrapDek(
        workspaceId,
        persisted.wrappedDek,
        persisted.kekVersion,
      );
      this.#set(workspaceId, dek);
      recordSecretsDekAccess({
        outcome: inserted ? 'generated' : 'db_unwrapped',
        durationMs: Date.now() - startedAt,
      });
      return Buffer.from(dek);
    } catch (error) {
      recordSecretsDekAccess({
        outcome: classifyDekAccessError(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  invalidate(workspaceId: string): void {
    this.#cache.delete(workspaceId);
  }

  #set(workspaceId: string, dek: Buffer): void {
    this.#cache.set(workspaceId, {
      dek: Buffer.from(dek),
      expiresAt: Date.now() + this.#options.ttlMs,
    });
    while (this.#cache.size > this.#options.maxEntries) {
      const oldest = this.#cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#cache.delete(oldest);
    }
  }
}
