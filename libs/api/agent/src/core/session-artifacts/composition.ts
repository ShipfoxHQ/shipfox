import {config} from '#config.js';
import {decodeBase64SessionKek} from './crypto.js';
import {SessionDekManager} from './dek-manager.js';
import {createSessionKeyProvider, type SessionKeyProvider} from './key-provider.js';
import {
  type RotateAgentSessionDataKeysOptions,
  rotateAgentSessionDataKeysWithProvider,
} from './rotate-kek.js';
import {createSessionArtifactStore, type SessionArtifactStore} from './store.js';

let memoizedKeyProvider: SessionKeyProvider | undefined;
let memoizedDekManager: SessionDekManager | undefined;
let memoizedArtifactStore: SessionArtifactStore | undefined;

/**
 * The current KEK wraps new session DEKs. The optional previous KEK keeps old
 * wraps readable until `rotateAgentSessionDataKeys` finishes rewrapping them.
 */
export function sessionKeyProvider(): SessionKeyProvider {
  if (memoizedKeyProvider) return memoizedKeyProvider;
  memoizedKeyProvider = createSessionKeyProvider(
    decodeBase64SessionKek(config.AGENT_SESSION_ENCRYPTION_KEK, 'AGENT_SESSION_ENCRYPTION_KEK'),
    config.AGENT_SESSION_ENCRYPTION_KEK_PREVIOUS
      ? decodeBase64SessionKek(
          config.AGENT_SESSION_ENCRYPTION_KEK_PREVIOUS,
          'AGENT_SESSION_ENCRYPTION_KEK_PREVIOUS',
        )
      : undefined,
  );
  return memoizedKeyProvider;
}

/** One DEK cache for everything sealed with the workspace data key. */
export function sessionDekManager(): SessionDekManager {
  memoizedDekManager ??= new SessionDekManager(sessionKeyProvider(), {
    maxEntries: 32,
    ttlMs: 60_000,
  });
  return memoizedDekManager;
}

/**
 * The module-wide encrypted session artifact store backing the lease-authed
 * transcript routes and the retention sweep. Memoized so routes, subscribers,
 * and activities share one DEK manager and one object-store client.
 */
export function sessionArtifactStore(): SessionArtifactStore {
  if (memoizedArtifactStore) return memoizedArtifactStore;
  memoizedArtifactStore = createSessionArtifactStore({dekManager: sessionDekManager()});
  return memoizedArtifactStore;
}

export function rotateAgentSessionDataKeys(options: RotateAgentSessionDataKeysOptions = {}) {
  return rotateAgentSessionDataKeysWithProvider(sessionKeyProvider(), options);
}
