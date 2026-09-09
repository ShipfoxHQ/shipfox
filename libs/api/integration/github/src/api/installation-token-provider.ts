import type {GetIntegrationConnectionByIdFn} from '@shipfox/api-integration-spi';
import {App, Octokit} from 'octokit';
import {config, normalizedGithubApiBaseUrl, normalizedGithubPrivateKey} from '#config.js';
import {GithubIntegrationProviderError} from '#core/errors.js';
import {withInstallationTokenLock} from '#db/installation-token-lock.js';
import {getGithubInstallationByInstallationId} from '#db/installations.js';
import {recordInstallationTokenFormat, recordInstallationTokenLookup} from '#metrics/index.js';
import {type GithubInstallationAccessToken, mapGithubError} from './client.js';
import {githubInstallationTokenFormatPlugin} from './github-octokit.js';
import {
  GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
  githubInstallationTokenNamespace,
  TOKEN_REFRESH_MARGIN_MS,
} from './installation-token-envelope.js';
import {
  type DeleteInstallationOptions,
  type InstallationTokenCache,
  type InstallationTokenSecretStore,
  SharedInstallationTokenCache,
  type SharedInstallationTokenCacheOptions,
} from './shared-installation-token-cache.js';

export type {DeleteInstallationOptions};

export interface GithubInstallationTokenProvider {
  /**
   * Returns the full GitHub installation grant for backend tool execution.
   * GitHub determines provider permissions from the installation configuration.
   * The installation ID is the only cache identity for this provider path.
   */
  getInstallationAccessToken(installationId: number): Promise<GithubInstallationAccessToken>;
  deleteInstallation?(installationId: number, options?: DeleteInstallationOptions): Promise<number>;
}

export interface GithubInstallationTokenProviderOptions {
  cache?: InstallationTokenCache | undefined;
  getIntegrationConnectionById?: GetIntegrationConnectionByIdFn | undefined;
  getGithubInstallationByInstallationId?: typeof getGithubInstallationByInstallationId | undefined;
  secretStore?: InstallationTokenSecretStore | undefined;
  withLock?: SharedInstallationTokenCacheOptions['withLock'] | undefined;
  now?: (() => Date) | undefined;
}

export function createGithubInstallationTokenProvider(
  options: GithubInstallationTokenProviderOptions = {},
): GithubInstallationTokenProvider {
  return new OctokitGithubInstallationTokenProvider(
    createInstallationTokenCache(options),
    options.getGithubInstallationByInstallationId ??
      (options.getIntegrationConnectionById ? getGithubInstallationByInstallationId : undefined),
  );
}

class OctokitGithubInstallationTokenProvider implements GithubInstallationTokenProvider {
  private app: App | undefined;

  constructor(
    private readonly cache: InstallationTokenCache = new InMemoryInstallationTokenCache(),
    private readonly getInstallationByInstallationId?: typeof getGithubInstallationByInstallationId,
  ) {}

  async getInstallationAccessToken(installationId: number): Promise<GithubInstallationAccessToken> {
    await this.assertInstallationIsActive(installationId);
    return await this.cache.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      () => this.mintInstallationAccessToken(installationId),
    );
  }

  async deleteInstallation(
    installationId: number,
    options?: DeleteInstallationOptions,
  ): Promise<number> {
    if (this.cache.deleteInstallation) {
      return await this.cache.deleteInstallation(installationId, options);
    }
    return options?.deleteNamespace ? await options.deleteNamespace(installationId) : 0;
  }

  private async assertInstallationIsActive(installationId: number): Promise<void> {
    // Providers without integration composition (for example isolated unit callers) do
    // not have installation state available; production composition always supplies it.
    if (!this.getInstallationByInstallationId) return;
    const installation = await this.getInstallationByInstallationId(String(installationId));
    if (!installation || installation.suspendedAt !== null || installation.deletedAt !== null) {
      throw new GithubIntegrationProviderError(
        'access-denied',
        `GitHub installation is not active: ${installationId}`,
      );
    }
  }

  private async mintInstallationAccessToken(
    installationId: number,
  ): Promise<GithubInstallationAccessToken> {
    const response = await mapGithubError(
      () =>
        this.getApp().octokit.rest.apps.createInstallationAccessToken({
          installation_id: installationId,
        }),
      'installation-not-found',
    );

    if (typeof response.data.token !== 'string') {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub installation access token response did not include a token',
      );
    }

    recordInstallationTokenFormat(response.data.token);

    const expiresAt = new Date(response.data.expires_at);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new GithubIntegrationProviderError(
        'malformed-provider-response',
        'GitHub installation access token response did not include a valid expiry',
      );
    }

    return {
      token: response.data.token,
      expiresAt,
      ...(response.data.permissions === undefined ? {} : {permissions: response.data.permissions}),
    };
  }

  private getApp(): App {
    if (!this.app) {
      this.app = new App({
        appId: config.GITHUB_APP_ID,
        privateKey: normalizedGithubPrivateKey(),
        Octokit: Octokit.plugin(githubInstallationTokenFormatPlugin).defaults({
          baseUrl: normalizedGithubApiBaseUrl(),
          throttle: {
            onRateLimit: (
              _retryAfter: number,
              _options: unknown,
              _octokit: unknown,
              retryCount: number,
            ) => retryCount === 0,
            onSecondaryRateLimit: (
              _retryAfter: number,
              _options: unknown,
              _octokit: unknown,
              retryCount: number,
            ) => retryCount === 0,
          },
        }),
      });
    }
    return this.app;
  }
}

class InMemoryInstallationTokenCache implements InstallationTokenCache {
  private readonly tokens = new Map<
    number,
    {token: GithubInstallationAccessToken; generation: string | null}
  >();
  private readonly inFlightMints = new Map<number, Promise<GithubInstallationAccessToken>>();
  private readonly inFlightEpochs = new Map<number, number>();
  private readonly generations = new Map<number, string | null>();
  private readonly epochs = new Map<number, number>();

  constructor(
    private readonly options: {
      refreshMarginMs: number;
      now: () => Date;
    } = {
      refreshMarginMs: TOKEN_REFRESH_MARGIN_MS,
      now: () => new Date(),
    },
  ) {}

  observeGeneration(installationId: number, generation: string | null): void {
    const previous = this.generations.get(installationId);
    if (previous === undefined) {
      this.generations.set(installationId, generation);
      return;
    }
    if (previous === generation) return;
    this.generations.set(installationId, generation);
    this.invalidateLocal(installationId);
  }

  getOrMint(
    installationId: number,
    _permissionFingerprint: string,
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken> {
    const epoch = this.epochs.get(installationId) ?? 0;
    const generation = this.generations.get(installationId) ?? null;
    const cached = this.tokens.get(installationId);
    if (
      cached &&
      cached.generation === generation &&
      !this.isInsideRefreshMargin(cached.token.expiresAt)
    ) {
      recordInstallationTokenLookup('ram-hit');
      return Promise.resolve(cached.token);
    }

    const inFlightMint = this.inFlightMints.get(installationId);
    if (inFlightMint && this.inFlightEpochs.get(installationId) === epoch) return inFlightMint;

    const freshToken = mint()
      .then((token) => {
        if ((this.epochs.get(installationId) ?? 0) !== epoch) {
          return this.getOrMint(installationId, _permissionFingerprint, mint);
        }
        this.tokens.set(installationId, {token, generation});
        return token;
      })
      .finally(() => {
        if (this.inFlightMints.get(installationId) === freshToken) {
          this.inFlightMints.delete(installationId);
          this.inFlightEpochs.delete(installationId);
        }
      });
    this.inFlightMints.set(installationId, freshToken);
    this.inFlightEpochs.set(installationId, epoch);
    return freshToken;
  }

  async deleteInstallation(
    installationId: number,
    options?: DeleteInstallationOptions,
  ): Promise<number> {
    const deleted = this.invalidateLocal(installationId);
    if (!options?.deleteNamespace) return deleted;
    return deleted + (await options.deleteNamespace(installationId));
  }

  private invalidateLocal(installationId: number): number {
    this.epochs.set(installationId, (this.epochs.get(installationId) ?? 0) + 1);
    return this.tokens.delete(installationId) ? 1 : 0;
  }

  private isInsideRefreshMargin(expiresAt: Date): boolean {
    return expiresAt.getTime() <= this.options.now().getTime() + this.options.refreshMarginMs;
  }
}

class TieredInstallationTokenCache implements InstallationTokenCache {
  constructor(
    private readonly ram: InstallationTokenCache,
    private readonly shared: InstallationTokenCache,
  ) {}

  async getOrMint(
    installationId: number,
    permissionFingerprint: string,
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken> {
    const generation = await this.readGeneration(installationId);
    this.ram.observeGeneration?.(installationId, generation);
    const result = await this.ram.getOrMint(installationId, permissionFingerprint, () =>
      this.shared.getOrMint(installationId, permissionFingerprint, mint),
    );
    const currentGeneration = await this.readGeneration(installationId);
    if (currentGeneration === generation) return result;

    this.ram.observeGeneration?.(installationId, currentGeneration);
    return await this.getOrMint(installationId, permissionFingerprint, mint);
  }

  async deleteInstallation(
    installationId: number,
    options?: DeleteInstallationOptions,
  ): Promise<number> {
    const deletedRam = (await this.ram.deleteInstallation?.(installationId)) ?? 0;
    const deletedShared = (await this.shared.deleteInstallation?.(installationId, options)) ?? 0;
    const deletedRamAfterShared = (await this.ram.deleteInstallation?.(installationId)) ?? 0;
    return deletedRam + deletedShared + deletedRamAfterShared;
  }

  private async readGeneration(installationId: number): Promise<string | null> {
    const shared = this.shared as InstallationTokenGenerationReader;
    return shared.readObservedGeneration
      ? await shared.readObservedGeneration(installationId)
      : null;
  }
}

type InstallationTokenGenerationReader = {
  readObservedGeneration?: (installationId: number) => Promise<string | null>;
};

function createInstallationTokenCache(
  options: GithubInstallationTokenProviderOptions,
): InstallationTokenCache {
  if (options.cache) return options.cache;

  const ram = new InMemoryInstallationTokenCache({
    refreshMarginMs: TOKEN_REFRESH_MARGIN_MS,
    now: options.now ?? (() => new Date()),
  });
  if (!options.getIntegrationConnectionById || !options.secretStore) return ram;

  const withLock = options.withLock ?? withInstallationTokenLock;
  const shared = new SharedInstallationTokenCache({
    secretStore: options.secretStore,
    withLock,
    withBackoffLock: withLock,
    shareCompatibilityLock: true,
    resolveWorkspaceId: createGithubInstallationWorkspaceResolver(
      options.getIntegrationConnectionById,
    ),
    now: options.now,
  });
  return new TieredInstallationTokenCache(ram, shared);
}

function createGithubInstallationWorkspaceResolver(
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn,
) {
  return async (installationId: number): Promise<string> => {
    const installation = await getGithubInstallationByInstallationId(String(installationId));
    if (!installation) {
      throw new GithubIntegrationProviderError(
        'installation-not-found',
        `GitHub installation not found: ${installationId}`,
      );
    }

    const connection = await getIntegrationConnectionById(installation.connectionId);
    if (!connection) {
      throw new GithubIntegrationProviderError(
        'installation-not-found',
        `GitHub installation connection not found: ${installation.connectionId}`,
      );
    }
    return connection.workspaceId;
  };
}

export function deleteGithubInstallationTokenSecret(params: {
  workspaceId: string;
  installationId: number;
  deleteSecrets: (params: {workspaceId: string; namespace: string}) => Promise<number>;
}): Promise<number> {
  return params.deleteSecrets({
    workspaceId: params.workspaceId,
    namespace: githubInstallationTokenNamespace(params.installationId),
  });
}
