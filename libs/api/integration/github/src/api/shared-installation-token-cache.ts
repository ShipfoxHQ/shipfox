import {randomUUID} from 'node:crypto';
import {setTimeout as sleepTimeout} from 'node:timers/promises';
import {reportError} from '@shipfox/node-error-monitoring';
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
  type ClassifiedMintError,
  classifyMintError,
  GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
  GITHUB_INSTALLATION_TOKEN_BACKOFF_KEY,
  GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY,
  githubInstallationTokenKey,
  type InstallationTokenEnvelope,
  mintErrorClassForReason,
  parseInstallationTokenEnvelope,
  providerErrorFromBackoff,
  stillValid,
  toProviderError,
  usable,
} from './installation-token-envelope.js';

export type DeleteInstallationNamespaceFn = (installationId: number) => Promise<number>;

export interface DeleteInstallationOptions {
  workspaceId?: string | undefined;
  deleteNamespace?: DeleteInstallationNamespaceFn | undefined;
}

export interface InstallationTokenCache {
  getOrMint(
    installationId: number,
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken>;
  deleteInstallation?(installationId: number, options?: DeleteInstallationOptions): Promise<number>;
  observeGeneration?(installationId: number, generation: string | null): void;
}

export type InstallationTokenLockResult<T> = {acquired: true; value: T} | {acquired: false};

export interface InstallationTokenSecretStore {
  read(workspaceId: string, installationId: number, key: string): Promise<string | null>;
  write(
    workspaceId: string,
    installationId: number,
    key: string,
    envelope: InstallationTokenEnvelope,
  ): Promise<void>;
  readGeneration?:
    | ((workspaceId: string, installationId: number) => Promise<string | null>)
    | undefined;
  writeGeneration?:
    | ((workspaceId: string, installationId: number, generation: string) => Promise<void>)
    | undefined;
}

type InstallationTokenLock = <T>(
  installationId: number,
  fn: () => Promise<T>,
) => Promise<InstallationTokenLockResult<T>>;

export interface SharedInstallationTokenCacheOptions {
  secretStore: InstallationTokenSecretStore;
  withLock: InstallationTokenLock;
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
type InstallationTokenGeneration = string | null | undefined;
type InstallationTokenEnvelopeWriteResult = 'written' | 'skipped' | 'contended';

const FULL_GRANT_TOKEN_KEY = githubInstallationTokenKey(
  GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
);
const FULL_GRANT_BACKOFF_KEY = GITHUB_INSTALLATION_TOKEN_BACKOFF_KEY;

interface MintUnderLockParams {
  workspaceId: string;
  installationId: number;
  mint: () => Promise<GithubInstallationAccessToken>;
  reportReadFailure: (error: unknown) => void;
}
type InstallationTokenBackoffResult = {until: Date; persisted: boolean};

export class SharedInstallationTokenCache implements InstallationTokenCache {
  private readonly workspaceIds = new Map<number, {workspaceId: string; expiresAtMs: number}>();
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollDelaysMs: number[];
  private readonly workspaceCacheTtlMs: number;
  private readonly mintTimeoutMs: number;
  private readonly generationFenceEnabled: boolean;

  constructor(private readonly options: SharedInstallationTokenCacheOptions) {
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => sleepTimeout(ms).then(() => undefined));
    this.pollDelaysMs = options.pollDelaysMs ?? DEFAULT_POLL_DELAYS_MS;
    this.workspaceCacheTtlMs = options.workspaceCacheTtlMs ?? DEFAULT_WORKSPACE_CACHE_TTL_MS;
    this.mintTimeoutMs = options.mintTimeoutMs ?? DEFAULT_MINT_TIMEOUT_MS;
    this.generationFenceEnabled =
      options.secretStore.readGeneration !== undefined &&
      options.secretStore.writeGeneration !== undefined;
  }

  async deleteInstallation(
    installationId: number,
    options: DeleteInstallationOptions = {},
  ): Promise<number> {
    if (!this.generationFenceEnabled) {
      this.workspaceIds.delete(installationId);
      return options.deleteNamespace ? await options.deleteNamespace(installationId) : 0;
    }

    const workspaceId = options.workspaceId ?? (await this.resolveWorkspaceId(installationId));
    const result = await this.retryWithInstallationLock(installationId, async () => {
      const generation = randomUUID();
      await this.writeGeneration(workspaceId, installationId, generation);
      let deleted = 0;
      try {
        deleted = options.deleteNamespace ? await options.deleteNamespace(installationId) : 0;
      } finally {
        await this.writeGeneration(workspaceId, installationId, generation);
      }
      return deleted;
    });
    if (!result.acquired) {
      throw new GithubIntegrationProviderError(
        'provider-unavailable',
        'GitHub installation token invalidation is still in progress',
        1,
      );
    }
    this.workspaceIds.delete(installationId);
    return result.value;
  }

  /** Reads the durable fence used by the RAM tier before it serves a token. */
  async readObservedGeneration(installationId: number): Promise<string | null> {
    if (!this.generationFenceEnabled) return null;
    const workspaceId = await this.resolveWorkspaceId(installationId);
    return (await this.readGeneration(workspaceId, installationId)) ?? null;
  }

  async getOrMint(
    installationId: number,
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken> {
    const workspaceId = await this.resolveWorkspaceId(installationId);
    let readFailureReported = false;
    const reportReadFailure = (error: unknown) => {
      if (readFailureReported) return;
      readFailureReported = true;
      logger().warn({installationId, error}, 'github installation token cache read failed');
      reportError(error, {
        boundary: 'integration.cache',
        operation: 'read-envelope',
        extra: {installationId},
      });
    };
    const generation = await this.readGeneration(workspaceId, installationId, reportReadFailure);
    const envelope = await this.readEnvelope(
      workspaceId,
      installationId,
      reportReadFailure,
      generation,
    );
    if (usable(envelope, this.now())) {
      const current = await this.generationMatchesDirect(
        workspaceId,
        installationId,
        generation,
        reportReadFailure,
      );
      if (current) {
        recordInstallationTokenLookup('db-hit');
        return tokenFromEnvelope(envelope);
      }
      return await this.getOrMint(installationId, mint);
    }

    let result: InstallationTokenLockResult<GithubInstallationAccessToken>;
    try {
      result = await this.options.withLock(installationId, () =>
        this.mintUnderLock({
          workspaceId,
          installationId,
          mint,
          reportReadFailure,
        }),
      );
    } catch (error) {
      if (!(error instanceof InstallationTokenMintFailure)) throw error;
      const backoff = await this.recordBackoff({
        workspaceId,
        installationId,
        reportReadFailure,
        failure: error,
        generation,
      });
      const current = await this.generationMatchesDirect(
        workspaceId,
        installationId,
        generation,
        reportReadFailure,
      );
      if (
        current &&
        error.failure.class === 'transient' &&
        error.failureEnvelope?.token &&
        stillValid(error.failureEnvelope.expiresAt, this.now())
      ) {
        logger().warn(
          {
            installationId,
            expiresAt: error.failureEnvelope.expiresAt?.toISOString(),
            reason: error.providerError.reason,
            backoffUntil: backoff.until.toISOString(),
            backoffPersisted: backoff.persisted,
          },
          'github installation token mint failed; serving stale token',
        );
        recordInstallationTokenLookup('served-stale');
        return tokenFromEnvelope(error.failureEnvelope);
      }

      logger().warn(
        {
          installationId,
          reason: error.providerError.reason,
          backoffUntil: backoff.until.toISOString(),
          backoffPersisted: backoff.persisted,
          error: error.providerError,
        },
        backoff.persisted
          ? 'github installation token mint failed; backoff recorded'
          : 'github installation token mint failed; backoff was not persisted',
      );
      recordInstallationTokenLookup('backoff');
      throw error.providerError;
    }
    if (result.acquired) {
      await this.clearBackoff({
        workspaceId,
        installationId,
        reportReadFailure,
        generation,
      });
      if (
        await this.generationMatchesDirect(
          workspaceId,
          installationId,
          generation,
          reportReadFailure,
        )
      ) {
        return result.value;
      }
      return await this.getOrMint(installationId, mint);
    }

    return await this.serveStaleOrPoll({
      workspaceId,
      installationId,
      envelope,
      reportReadFailure,
      generation,
      mint,
    });
  }

  private async mintUnderLock(params: MintUnderLockParams): Promise<GithubInstallationAccessToken> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await this.runMintAttempt(params);
      if (result !== undefined) return result;
    }

    throw new GithubIntegrationProviderError(
      'provider-unavailable',
      'GitHub installation token was invalidated while minting',
      1,
    );
  }

  private async runMintAttempt(
    params: MintUnderLockParams,
  ): Promise<GithubInstallationAccessToken | undefined> {
    const generation = await this.readGeneration(
      params.workspaceId,
      params.installationId,
      params.reportReadFailure,
    );
    const envelope = await this.readEnvelope(
      params.workspaceId,
      params.installationId,
      params.reportReadFailure,
      generation,
    );
    const now = this.now();
    if (usable(envelope, now)) {
      const current = await this.generationMatchesDirect(
        params.workspaceId,
        params.installationId,
        generation,
        params.reportReadFailure,
      );
      if (!current) return undefined;
      recordInstallationTokenLookup('db-hit');
      return tokenFromEnvelope(envelope);
    }

    if (activeBackoff(envelope, now)) {
      if (canServeStale(envelope, now)) {
        const current = await this.generationMatchesDirect(
          params.workspaceId,
          params.installationId,
          generation,
          params.reportReadFailure,
        );
        if (!current) return undefined;
        recordInstallationTokenLookup('served-stale');
        return tokenFromEnvelope(envelope);
      }
      recordInstallationTokenLookup('backoff');
      throw providerErrorFromBackoff(
        envelope?.backoffReason ?? 'provider-unavailable',
        (envelope?.backoffUntil?.getTime() ?? now.getTime()) - now.getTime(),
        envelope?.backoffError,
      );
    }

    return await this.mintAndCommit(params, generation, envelope);
  }

  private async mintAndCommit(
    params: MintUnderLockParams,
    generation: InstallationTokenGeneration,
    envelope: InstallationTokenEnvelope | undefined,
  ): Promise<GithubInstallationAccessToken | undefined> {
    let token: GithubInstallationAccessToken;
    try {
      token = await this.recordMint(params.mint);
    } catch (error) {
      const providerError = toProviderError(error);
      const failure = classifyMintError(providerError);
      recordInstallationTokenBackoff({
        reason: failure.reason,
        class: failure.class,
      });
      throw new InstallationTokenMintFailure(providerError, failure, envelope);
    }

    const writeResult = await this.writeMintedEnvelope(params, generation, token);
    if (writeResult === 'skipped') return undefined;
    if (writeResult === 'contended') {
      logger().warn(
        {installationId: params.installationId},
        'github installation token cache write lock was contended',
      );
    }

    logger().info(
      {
        installationId: params.installationId,
        expiresAt: token.expiresAt.toISOString(),
      },
      'github installation token minted',
    );
    recordInstallationTokenLookup('minted');
    return token;
  }

  private async writeMintedEnvelope(
    params: MintUnderLockParams,
    generation: InstallationTokenGeneration,
    token: GithubInstallationAccessToken,
  ): Promise<InstallationTokenEnvelopeWriteResult> {
    try {
      return await this.writeEnvelope(
        params.workspaceId,
        params.installationId,
        FULL_GRANT_TOKEN_KEY,
        {
          token: token.token,
          expiresAt: token.expiresAt,
          permissions: token.permissions,
        },
        generation,
        true,
        params.reportReadFailure,
      );
    } catch (error) {
      logger().warn(
        {installationId: params.installationId, expiresAt: token.expiresAt.toISOString(), error},
        'github installation token cache write failed after mint',
      );
      reportError(error, {
        boundary: 'integration.cache',
        operation: 'write-minted-token',
        extra: {installationId: params.installationId},
      });
      return 'written';
    }
  }

  private async recordBackoff(params: {
    workspaceId: string;
    installationId: number;
    reportReadFailure: (error: unknown) => void;
    failure: InstallationTokenMintFailure;
    generation: InstallationTokenGeneration;
  }): Promise<InstallationTokenBackoffResult> {
    const candidateUntil = new Date(this.now().getTime() + backoffMs(params.failure.failure));
    if (params.generation === undefined) return {until: candidateUntil, persisted: false};

    try {
      const result = await this.retryWithInstallationLock(params.installationId, () =>
        this.persistBackoff({...params, candidateUntil}),
      );
      if (result.acquired) return result.value;
      logger().warn(
        {
          installationId: params.installationId,
          reason: params.failure.failure.reason,
        },
        'github installation token backoff lock was contended',
      );
    } catch (error) {
      logger().warn(
        {
          installationId: params.installationId,
          reason: params.failure.failure.reason,
          error,
        },
        'github installation token backoff write failed',
      );
      reportError(error, {
        boundary: 'integration.cache',
        operation: 'write-backoff-envelope',
        extra: {installationId: params.installationId},
      });
    }
    return {until: candidateUntil, persisted: false};
  }

  private async persistBackoff(params: {
    workspaceId: string;
    installationId: number;
    reportReadFailure: (error: unknown) => void;
    failure: InstallationTokenMintFailure;
    generation: InstallationTokenGeneration;
    candidateUntil: Date;
  }): Promise<InstallationTokenBackoffResult> {
    const current = await this.readGeneration(
      params.workspaceId,
      params.installationId,
      params.reportReadFailure,
    );
    if (current !== params.generation) {
      return {until: params.candidateUntil, persisted: false};
    }

    let readFailed = false;
    const reportReadFailure = (error: unknown) => {
      readFailed = true;
      params.reportReadFailure(error);
    };
    const envelope = await this.readEnvelope(
      params.workspaceId,
      params.installationId,
      reportReadFailure,
      params.generation,
    );
    const existingBackoff =
      envelope?.backoffUntil !== undefined && envelope.backoffReason !== undefined
        ? {
            backoffUntil: envelope.backoffUntil,
            backoffReason: envelope.backoffReason,
            backoffError: envelope.backoffError,
          }
        : undefined;
    const selectedBackoff =
      existingBackoff && existingBackoff.backoffUntil.getTime() >= params.candidateUntil.getTime()
        ? existingBackoff
        : {
            backoffUntil: params.candidateUntil,
            backoffReason: params.failure.failure.reason,
            backoffError: {
              message: params.failure.providerError.message,
              ...(params.failure.providerError.status === undefined
                ? {}
                : {status: params.failure.providerError.status}),
            },
          };
    const backoffResult = await this.writeEnvelope(
      params.workspaceId,
      params.installationId,
      FULL_GRANT_BACKOFF_KEY,
      selectedBackoff,
      params.generation,
      true,
      params.reportReadFailure,
    );
    if (!readFailed) {
      try {
        await this.writeEnvelope(
          params.workspaceId,
          params.installationId,
          FULL_GRANT_TOKEN_KEY,
          {
            token: envelope?.token,
            expiresAt: envelope?.expiresAt,
            permissions: envelope?.permissions,
          },
          params.generation,
          true,
          params.reportReadFailure,
        );
      } catch (error) {
        logger().warn(
          {
            installationId: params.installationId,
            error,
          },
          'github installation token cache preservation failed',
        );
        reportError(error, {
          boundary: 'integration.cache',
          operation: 'write-token-envelope',
          extra: {installationId: params.installationId},
        });
      }
    }
    return {
      until: selectedBackoff.backoffUntil,
      persisted: backoffResult === 'written',
    };
  }

  private async clearBackoff(params: {
    workspaceId: string;
    installationId: number;
    reportReadFailure: (error: unknown) => void;
    generation: InstallationTokenGeneration;
  }): Promise<void> {
    try {
      await this.retryWithInstallationLock(params.installationId, async () => {
        if (
          !(await this.generationMatches(
            params.workspaceId,
            params.installationId,
            params.generation,
            params.reportReadFailure,
            true,
          ))
        )
          return;
        let readFailed = false;
        const envelope = await this.readEnvelope(
          params.workspaceId,
          params.installationId,
          (error) => {
            readFailed = true;
            params.reportReadFailure(error);
          },
          params.generation,
        );
        if (readFailed || activeBackoff(envelope, this.now())) return;
        await this.writeEnvelope(
          params.workspaceId,
          params.installationId,
          FULL_GRANT_BACKOFF_KEY,
          {},
          params.generation,
          true,
          params.reportReadFailure,
        );
      });
    } catch (error) {
      logger().warn(
        {installationId: params.installationId, error},
        'github installation token backoff clear failed',
      );
      reportError(error, {
        boundary: 'integration.cache',
        operation: 'clear-backoff-envelope',
        extra: {installationId: params.installationId},
      });
    }
  }

  private async retryWithInstallationLock<T>(
    installationId: number,
    operation: () => Promise<T>,
  ): Promise<InstallationTokenLockResult<T>> {
    for (const delayMs of [0, ...this.pollDelaysMs]) {
      if (delayMs > 0) await this.sleep(delayMs);
      const result = await this.options.withLock(installationId, operation);
      if (result.acquired) return result;
    }
    return {acquired: false};
  }

  private async serveStaleOrPoll(params: {
    workspaceId: string;
    installationId: number;
    envelope: InstallationTokenEnvelope | undefined;
    reportReadFailure: (error: unknown) => void;
    generation: InstallationTokenGeneration;
    mint: () => Promise<GithubInstallationAccessToken>;
  }): Promise<GithubInstallationAccessToken> {
    const current = await this.generationMatchesDirect(
      params.workspaceId,
      params.installationId,
      params.generation,
      params.reportReadFailure,
    );
    if (!current) {
      return await this.getOrMint(params.installationId, params.mint);
    }

    const initialNow = this.now();
    if (canServeStale(params.envelope, initialNow)) {
      recordInstallationTokenLookup('served-stale');
      return tokenFromEnvelope(params.envelope);
    }
    if (activeBackoff(params.envelope, initialNow)) {
      recordInstallationTokenLookup('backoff');
      throw providerErrorFromBackoff(
        params.envelope.backoffReason,
        params.envelope.backoffUntil.getTime() - initialNow.getTime(),
        params.envelope.backoffError,
      );
    }

    for (const delayMs of this.pollDelaysMs) {
      await this.sleep(delayMs);
      const envelope = await this.readEnvelope(
        params.workspaceId,
        params.installationId,
        params.reportReadFailure,
        params.generation,
      );
      const now = this.now();
      if (usable(envelope, now)) {
        if (
          await this.generationMatchesDirect(
            params.workspaceId,
            params.installationId,
            params.generation,
            params.reportReadFailure,
          )
        ) {
          recordInstallationTokenLookup('contended-poll');
          return tokenFromEnvelope(envelope);
        }
        return await this.getOrMint(params.installationId, params.mint);
      }
      if (backoffActive(envelope, now)) {
        recordInstallationTokenLookup('backoff');
        throw providerErrorFromBackoff(
          envelope?.backoffReason ?? 'provider-unavailable',
          (envelope?.backoffUntil?.getTime() ?? now.getTime()) - now.getTime(),
          envelope?.backoffError,
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
    reportReadFailure: (error: unknown) => void,
    generation: InstallationTokenGeneration,
  ): Promise<InstallationTokenEnvelope | undefined> {
    const {tokenResult, backoffResult, fixedEnvelopeResult} = await readSecretValues(
      this.options.secretStore,
      workspaceId,
      installationId,
      FULL_GRANT_TOKEN_KEY,
      FULL_GRANT_BACKOFF_KEY,
    );
    reportSecretReadFailure(tokenResult, reportReadFailure);
    reportSecretReadFailure(backoffResult, reportReadFailure);
    reportSecretReadFailure(fixedEnvelopeResult, reportReadFailure);

    const tokenRaw = settledRaw(tokenResult);
    const backoffRaw = settledRaw(backoffResult);
    const fixedEnvelopeRaw = settledRaw(fixedEnvelopeResult);
    let token = matchesGeneration(parseRawEnvelope(tokenRaw, installationId), generation);
    let backoff = matchesGeneration(parseRawEnvelope(backoffRaw, installationId), generation);
    const fixedEnvelope = matchesGeneration(
      parseRawEnvelope(fixedEnvelopeRaw, installationId),
      generation,
    );
    if (token === undefined && tokenRaw === null) {
      token = fixedEnvelope;
    }
    if (backoff === undefined && backoffRaw === null) {
      backoff = fixedEnvelope;
    }
    if (!token && !backoff) return undefined;
    return {
      ...token,
      ...(backoff?.generation === undefined ? {} : {generation: backoff.generation}),
      ...(backoff?.backoffUntil === undefined ? {} : {backoffUntil: backoff.backoffUntil}),
      ...(backoff?.backoffReason === undefined ? {} : {backoffReason: backoff.backoffReason}),
      ...(backoff?.backoffError === undefined ? {} : {backoffError: backoff.backoffError}),
    };
  }

  private async readGeneration(
    workspaceId: string,
    installationId: number,
    reportReadFailure?: (error: unknown) => void,
  ): Promise<InstallationTokenGeneration> {
    if (!this.generationFenceEnabled) return null;
    const readGeneration = this.options.secretStore.readGeneration;
    if (!readGeneration) return null;
    try {
      return await readGeneration(workspaceId, installationId);
    } catch (error) {
      reportReadFailure?.(error);
      throw new GithubIntegrationProviderError(
        'provider-unavailable',
        'GitHub installation token invalidation fence is unavailable',
        1,
      );
    }
  }

  private async writeGeneration(
    workspaceId: string,
    installationId: number,
    generation: string,
  ): Promise<void> {
    const writeGeneration = this.options.secretStore.writeGeneration;
    if (!writeGeneration) return;
    try {
      await writeGeneration(workspaceId, installationId, generation);
    } catch (error) {
      throw new GithubIntegrationProviderError(
        'provider-unavailable',
        `GitHub installation token invalidation fence could not be written: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
        1,
      );
    }
  }

  private async generationMatches(
    workspaceId: string,
    installationId: number,
    generation: InstallationTokenGeneration,
    reportReadFailure?: (error: unknown) => void,
    lockHeld = false,
  ): Promise<boolean> {
    if (!this.generationFenceEnabled) return true;
    if (generation === undefined) return false;
    const read = () =>
      this.generationMatchesDirect(workspaceId, installationId, generation, reportReadFailure);
    if (lockHeld) return await read();
    const result = await this.retryWithInstallationLock(installationId, read);
    if (!result.acquired) {
      throw new GithubIntegrationProviderError(
        'provider-unavailable',
        'GitHub installation token invalidation fence is still in progress',
        1,
      );
    }
    return result.value;
  }

  private async generationMatchesDirect(
    workspaceId: string,
    installationId: number,
    generation: InstallationTokenGeneration,
    reportReadFailure?: (error: unknown) => void,
  ): Promise<boolean> {
    if (!this.generationFenceEnabled) return true;
    if (generation === undefined) return false;
    return (
      (await this.readGeneration(workspaceId, installationId, reportReadFailure)) === generation
    );
  }

  private async writeEnvelope(
    workspaceId: string,
    installationId: number,
    key: string,
    envelope: InstallationTokenEnvelope,
    generation: InstallationTokenGeneration = null,
    lockHeld = false,
    reportReadFailure?: (error: unknown) => void,
  ): Promise<InstallationTokenEnvelopeWriteResult> {
    const write = async (
      lockHeldByCaller: boolean,
    ): Promise<InstallationTokenEnvelopeWriteResult> => {
      if (
        this.generationFenceEnabled &&
        !(await this.generationMatches(
          workspaceId,
          installationId,
          generation,
          reportReadFailure,
          lockHeldByCaller,
        ))
      ) {
        return 'skipped';
      }
      await this.options.secretStore.write(workspaceId, installationId, key, {
        ...envelope,
        ...(this.generationFenceEnabled && generation !== null ? {generation} : {}),
      });
      return 'written';
    };
    if (!this.generationFenceEnabled || lockHeld) return await write(lockHeld);
    const result = await this.retryWithInstallationLock(installationId, () => write(true));
    if (!result.acquired) return 'contended';
    return result.value;
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

type SettledSecretRead = PromiseSettledResult<string | null>;

interface InstallationTokenSecretReads {
  tokenResult: SettledSecretRead;
  backoffResult: SettledSecretRead;
  fixedEnvelopeResult: SettledSecretRead;
}

async function readSecretValues(
  secretStore: InstallationTokenSecretStore,
  workspaceId: string,
  installationId: number,
  tokenKey: string,
  backoffKey: string,
): Promise<InstallationTokenSecretReads> {
  const tokenRead = secretStore.read(workspaceId, installationId, tokenKey);
  const backoffRead = secretStore.read(workspaceId, installationId, backoffKey);
  const fixedEnvelopeRead = secretStore.read(
    workspaceId,
    installationId,
    GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY,
  );
  const [tokenResult, backoffResult, fixedEnvelopeResult] = await Promise.allSettled([
    tokenRead,
    backoffRead,
    fixedEnvelopeRead,
  ]);
  return {
    tokenResult,
    backoffResult,
    fixedEnvelopeResult,
  };
}

function reportSecretReadFailure(
  result: SettledSecretRead,
  report: (error: unknown) => void,
): void {
  if (result.status === 'rejected') report(result.reason);
}

function settledRaw(result: SettledSecretRead): string | null | undefined {
  if (result.status === 'rejected') return undefined;
  return result.value;
}

function parseRawEnvelope(
  raw: string | null | undefined,
  installationId: number,
): InstallationTokenEnvelope | undefined {
  if (raw === null || raw === undefined) return undefined;
  const envelope = parseInstallationTokenEnvelope(raw);
  if (envelope === undefined) {
    logger().warn({installationId}, 'github installation token cache envelope failed to decode');
  }
  return envelope;
}

function matchesGeneration(
  envelope: InstallationTokenEnvelope | undefined,
  generation: InstallationTokenGeneration,
): InstallationTokenEnvelope | undefined {
  if (envelope === undefined) return undefined;
  if (generation === undefined) return undefined;
  return envelope.generation === (generation === null ? undefined : generation)
    ? envelope
    : undefined;
}

class InstallationTokenMintFailure extends Error {
  constructor(
    readonly providerError: GithubIntegrationProviderError,
    readonly failure: ClassifiedMintError,
    readonly failureEnvelope: InstallationTokenEnvelope | undefined,
  ) {
    super(providerError.message);
    this.name = 'InstallationTokenMintFailure';
  }
}

type ActiveBackoffEnvelope = InstallationTokenEnvelope & {
  backoffUntil: Date;
  backoffReason: NonNullable<InstallationTokenEnvelope['backoffReason']>;
};

type TokenEnvelope = InstallationTokenEnvelope & {token: string; expiresAt: Date};

function activeBackoff(
  envelope: InstallationTokenEnvelope | undefined,
  now: Date,
): envelope is ActiveBackoffEnvelope {
  return (
    backoffActive(envelope, now) &&
    envelope?.backoffUntil !== undefined &&
    envelope.backoffReason !== undefined
  );
}

function canServeStale(
  envelope: InstallationTokenEnvelope | undefined,
  now: Date,
): envelope is TokenEnvelope {
  const terminalBackoff =
    activeBackoff(envelope, now) && mintErrorClassForReason(envelope.backoffReason) === 'terminal';
  return (
    envelope?.token !== undefined &&
    envelope.expiresAt !== undefined &&
    stillValid(envelope.expiresAt, now) &&
    !terminalBackoff
  );
}

function tokenFromEnvelope(envelope: InstallationTokenEnvelope): GithubInstallationAccessToken {
  if (!envelope.token || !envelope.expiresAt) {
    throw new GithubIntegrationProviderError(
      'malformed-provider-response',
      'GitHub installation token cache envelope is missing a token or expiry',
    );
  }
  return {
    token: envelope.token,
    expiresAt: envelope.expiresAt,
    ...(envelope.permissions === undefined ? {} : {permissions: envelope.permissions}),
  };
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
