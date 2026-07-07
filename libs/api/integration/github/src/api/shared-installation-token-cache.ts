import {setTimeout as sleepTimeout} from 'node:timers/promises';
import {logger} from '@shipfox/node-opentelemetry';
import {GithubIntegrationProviderError} from '#core/errors.js';
import {
  recordInstallationTokenBackoff,
  recordInstallationTokenLookup,
  recordInstallationTokenMint,
} from '#metrics/index.js';
import type {GithubInstallationAccessToken} from './client.js';
import {
  backoffActive,
  backoffMs,
  classifyMintError,
  type InstallationTokenEnvelope,
  parseInstallationTokenEnvelope,
  providerErrorFromBackoff,
  stillValid,
  toProviderError,
  usable,
} from './installation-token-envelope.js';

export interface InstallationTokenCache {
  getOrMint(
    installationId: number,
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken>;
}

export type InstallationTokenLockResult<T> = {acquired: true; value: T} | {acquired: false};

export interface InstallationTokenSecretStore {
  read(workspaceId: string, installationId: number): Promise<string | null>;
  write(
    workspaceId: string,
    installationId: number,
    envelope: InstallationTokenEnvelope,
  ): Promise<void>;
}

export interface SharedInstallationTokenCacheOptions {
  secretStore: InstallationTokenSecretStore;
  withLock: <T>(
    installationId: number,
    fn: () => Promise<T>,
  ) => Promise<InstallationTokenLockResult<T>>;
  resolveWorkspaceId: (installationId: number) => Promise<string>;
  now?: (() => Date) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  pollDelaysMs?: number[] | undefined;
  workspaceCacheTtlMs?: number | undefined;
  mintTimeoutMs?: number | undefined;
}

const DEFAULT_POLL_DELAYS_MS = [100, 200, 400, 500, 800];
const DEFAULT_WORKSPACE_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MINT_TIMEOUT_MS = 30 * 1000;

export class SharedInstallationTokenCache implements InstallationTokenCache {
  private readonly workspaceIds = new Map<number, {workspaceId: string; expiresAtMs: number}>();
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollDelaysMs: number[];
  private readonly workspaceCacheTtlMs: number;
  private readonly mintTimeoutMs: number;

  constructor(private readonly options: SharedInstallationTokenCacheOptions) {
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => sleepTimeout(ms).then(() => undefined));
    this.pollDelaysMs = options.pollDelaysMs ?? DEFAULT_POLL_DELAYS_MS;
    this.workspaceCacheTtlMs = options.workspaceCacheTtlMs ?? DEFAULT_WORKSPACE_CACHE_TTL_MS;
    this.mintTimeoutMs = options.mintTimeoutMs ?? DEFAULT_MINT_TIMEOUT_MS;
  }

  async getOrMint(
    installationId: number,
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken> {
    const workspaceId = await this.resolveWorkspaceId(installationId);
    const envelope = await this.readEnvelope(workspaceId, installationId);
    if (usable(envelope, this.now())) {
      recordInstallationTokenLookup('db-hit');
      return tokenFromEnvelope(envelope);
    }

    const result = await this.options.withLock(installationId, () =>
      this.mintUnderLock({workspaceId, installationId, mint}),
    );
    if (result.acquired) return result.value;

    return await this.serveStaleOrPoll({workspaceId, installationId, envelope});
  }

  private async mintUnderLock(params: {
    workspaceId: string;
    installationId: number;
    mint: () => Promise<GithubInstallationAccessToken>;
  }): Promise<GithubInstallationAccessToken> {
    const envelope = await this.readEnvelope(params.workspaceId, params.installationId);
    const now = this.now();
    if (usable(envelope, now)) {
      recordInstallationTokenLookup('db-hit');
      return tokenFromEnvelope(envelope);
    }

    if (backoffActive(envelope, now)) {
      if (envelope?.token && stillValid(envelope.expiresAt, now)) {
        recordInstallationTokenLookup('served-stale');
        return tokenFromEnvelope(envelope);
      }
      recordInstallationTokenLookup('backoff');
      throw providerErrorFromBackoff(
        envelope?.backoffReason ?? 'provider-unavailable',
        (envelope?.backoffUntil?.getTime() ?? now.getTime()) - now.getTime(),
      );
    }

    let token: GithubInstallationAccessToken;
    try {
      token = await this.recordMint(params.mint);
    } catch (error) {
      const providerError = toProviderError(error);
      const classified = classifyMintError(providerError);
      const until = new Date(this.now().getTime() + backoffMs(classified));
      recordInstallationTokenBackoff({reason: classified.reason, class: classified.class});

      await this.writeEnvelope(params.workspaceId, params.installationId, {
        token: envelope?.token,
        expiresAt: envelope?.expiresAt,
        backoffUntil: until,
        backoffReason: classified.reason,
      }).catch((writeError) => {
        logger().warn(
          {installationId: params.installationId, reason: classified.reason, error: writeError},
          'github installation token backoff write failed',
        );
      });

      if (envelope?.token && stillValid(envelope.expiresAt, this.now())) {
        logger().warn(
          {
            installationId: params.installationId,
            expiresAt: envelope.expiresAt?.toISOString(),
            reason: classified.reason,
            backoffUntil: until.toISOString(),
          },
          'github installation token mint failed; serving stale token',
        );
        recordInstallationTokenLookup('served-stale');
        return tokenFromEnvelope(envelope);
      }

      logger().warn(
        {
          installationId: params.installationId,
          reason: classified.reason,
          backoffUntil: until.toISOString(),
          error: providerError,
        },
        'github installation token mint failed; backoff recorded',
      );
      recordInstallationTokenLookup('backoff');
      throw providerError;
    }

    try {
      await this.writeEnvelope(params.workspaceId, params.installationId, {
        token: token.token,
        expiresAt: token.expiresAt,
      });
    } catch (error) {
      logger().warn(
        {installationId: params.installationId, expiresAt: token.expiresAt.toISOString(), error},
        'github installation token cache write failed after mint',
      );
    }

    logger().info(
      {installationId: params.installationId, expiresAt: token.expiresAt.toISOString()},
      'github installation token minted',
    );
    recordInstallationTokenLookup('minted');
    return token;
  }

  private async serveStaleOrPoll(params: {
    workspaceId: string;
    installationId: number;
    envelope: InstallationTokenEnvelope | undefined;
  }): Promise<GithubInstallationAccessToken> {
    if (params.envelope?.token && stillValid(params.envelope.expiresAt, this.now())) {
      recordInstallationTokenLookup('served-stale');
      return tokenFromEnvelope(params.envelope);
    }

    for (const delayMs of this.pollDelaysMs) {
      await this.sleep(delayMs);
      const envelope = await this.readEnvelope(params.workspaceId, params.installationId);
      const now = this.now();
      if (usable(envelope, now)) {
        recordInstallationTokenLookup('contended-poll');
        return tokenFromEnvelope(envelope);
      }
      if (backoffActive(envelope, now)) {
        recordInstallationTokenLookup('backoff');
        throw providerErrorFromBackoff(
          envelope?.backoffReason ?? 'provider-unavailable',
          (envelope?.backoffUntil?.getTime() ?? now.getTime()) - now.getTime(),
        );
      }
    }

    throw new GithubIntegrationProviderError(
      'provider-unavailable',
      'GitHub installation token mint is still in progress',
      1,
    );
  }

  private async recordMint(
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken> {
    const startedAt = Date.now();
    try {
      const token = await withTimeout(mint(), this.mintTimeoutMs);
      recordInstallationTokenMint({outcome: 'success', durationMs: Date.now() - startedAt});
      return token;
    } catch (error) {
      recordInstallationTokenMint({outcome: 'failure', durationMs: Date.now() - startedAt});
      throw error;
    }
  }

  private async readEnvelope(
    workspaceId: string,
    installationId: number,
  ): Promise<InstallationTokenEnvelope | undefined> {
    const raw = await this.options.secretStore.read(workspaceId, installationId);
    if (raw === null) return undefined;

    const envelope = parseInstallationTokenEnvelope(raw);
    if (envelope === undefined) {
      logger().warn({installationId}, 'github installation token cache envelope failed to decode');
    }
    return envelope;
  }

  private async writeEnvelope(
    workspaceId: string,
    installationId: number,
    envelope: InstallationTokenEnvelope,
  ): Promise<void> {
    await this.options.secretStore.write(workspaceId, installationId, envelope);
  }

  private async resolveWorkspaceId(installationId: number): Promise<string> {
    const nowMs = this.now().getTime();
    const cached = this.workspaceIds.get(installationId);
    if (cached && cached.expiresAtMs > nowMs) return cached.workspaceId;

    const workspaceId = await this.options.resolveWorkspaceId(installationId);
    this.workspaceIds.set(installationId, {
      workspaceId,
      expiresAtMs: nowMs + this.workspaceCacheTtlMs,
    });
    return workspaceId;
  }
}

function tokenFromEnvelope(envelope: InstallationTokenEnvelope): GithubInstallationAccessToken {
  if (!envelope.token || !envelope.expiresAt) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub installation token cache envelope is missing a token or expiry',
    );
  }
  return {token: envelope.token, expiresAt: envelope.expiresAt};
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new GithubIntegrationProviderError(
          'timeout',
          'Timed out minting GitHub installation access token',
        ),
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
