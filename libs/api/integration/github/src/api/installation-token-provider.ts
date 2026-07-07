import {App, Octokit} from 'octokit';
import {config, normalizedGithubPrivateKey} from '#config.js';
import {GithubIntegrationProviderError} from '#core/errors.js';
import {type GithubInstallationAccessToken, mapGithubError} from './client.js';

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface GithubInstallationTokenProvider {
  getInstallationAccessToken(installationId: number): Promise<GithubInstallationAccessToken>;
}

interface InstallationTokenCache {
  getOrMint(
    installationId: number,
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken>;
}

export function createGithubInstallationTokenProvider(): GithubInstallationTokenProvider {
  return new OctokitGithubInstallationTokenProvider();
}

class OctokitGithubInstallationTokenProvider implements GithubInstallationTokenProvider {
  private app: App | undefined;

  constructor(
    private readonly cache: InstallationTokenCache = new InMemoryInstallationTokenCache(),
  ) {}

  getInstallationAccessToken(installationId: number): Promise<GithubInstallationAccessToken> {
    return this.cache.getOrMint(installationId, () =>
      this.mintInstallationAccessToken(installationId),
    );
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
    };
  }

  private getApp(): App {
    if (!this.app) {
      this.app = new App({
        appId: config.GITHUB_APP_ID,
        privateKey: normalizedGithubPrivateKey(),
        Octokit: Octokit.defaults({
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
  private readonly tokens = new Map<number, GithubInstallationAccessToken>();
  private readonly inFlightMints = new Map<number, Promise<GithubInstallationAccessToken>>();

  constructor(
    private readonly options: {
      refreshMarginMs: number;
      now: () => Date;
    } = {
      refreshMarginMs: TOKEN_REFRESH_MARGIN_MS,
      now: () => new Date(),
    },
  ) {}

  getOrMint(
    installationId: number,
    mint: () => Promise<GithubInstallationAccessToken>,
  ): Promise<GithubInstallationAccessToken> {
    const cached = this.tokens.get(installationId);
    if (cached && !this.isInsideRefreshMargin(cached.expiresAt)) {
      return Promise.resolve(cached);
    }

    const inFlightMint = this.inFlightMints.get(installationId);
    if (inFlightMint) return inFlightMint;

    const freshToken = mint()
      .then((token) => {
        this.tokens.set(installationId, token);
        return token;
      })
      .finally(() => {
        this.inFlightMints.delete(installationId);
      });
    this.inFlightMints.set(installationId, freshToken);
    return freshToken;
  }

  private isInsideRefreshMargin(expiresAt: Date): boolean {
    return expiresAt.getTime() <= this.options.now().getTime() + this.options.refreshMarginMs;
  }
}
