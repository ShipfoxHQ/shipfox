import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import type {SentryApiClient} from '#api/client.js';
import {SentryInstallationAlreadyLinkedError} from '#core/errors.js';
import {type ConnectSentryInstallationInput, handleSentryConnect} from './install.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const INSTALL_UUID = 'install-uuid-1';

function sentryClient(overrides: Partial<SentryApiClient> = {}): SentryApiClient {
  return {
    exchangeAuthorizationCode: vi.fn(() =>
      Promise.resolve({token: 'tok', refreshToken: 'refresh', expiresAt: 'x'}),
    ),
    getInstallation: vi.fn(() => Promise.resolve({orgSlug: 'acme'})),
    verifyInstallation: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function connection(
  overrides: Partial<IntegrationConnection<'sentry'>> = {},
): IntegrationConnection<'sentry'> {
  return {
    id: crypto.randomUUID(),
    workspaceId: WORKSPACE_ID,
    provider: 'sentry',
    externalAccountId: INSTALL_UUID,
    displayName: 'Sentry acme',
    lifecycleStatus: 'active',
    capabilities: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface RunOptions {
  sentry?: SentryApiClient;
  verifyInstall?: boolean;
  existing?: IntegrationConnection<'sentry'> | undefined;
}

function run(options: RunOptions = {}) {
  const sentry = options.sentry ?? sentryClient();
  const connectSentryInstallation = vi.fn((input: ConnectSentryInstallationInput) =>
    Promise.resolve(
      connection({
        workspaceId: input.workspaceId,
        externalAccountId: input.installationUuid,
        displayName: input.displayName,
      }),
    ),
  );
  const getExistingSentryConnection = vi.fn(() => Promise.resolve(options.existing));

  const result = handleSentryConnect({
    sentry,
    workspaceId: WORKSPACE_ID,
    code: 'the-code',
    installationUuid: INSTALL_UUID,
    installerUserId: 'user-1',
    verifyInstall: options.verifyInstall ?? true,
    getExistingSentryConnection,
    connectSentryInstallation,
  });

  return {sentry, connectSentryInstallation, getExistingSentryConnection, result};
}

describe('handleSentryConnect', () => {
  it('exchanges, derives the org, persists, then verifies last', async () => {
    const sentry = sentryClient();
    const {connectSentryInstallation, result} = run({sentry});

    const connected = await result;

    expect(sentry.exchangeAuthorizationCode).toHaveBeenCalledWith({
      installationUuid: INSTALL_UUID,
      code: 'the-code',
    });
    expect(connectSentryInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        installationUuid: INSTALL_UUID,
        orgSlug: 'acme',
        displayName: 'Sentry acme',
        installerUserId: 'user-1',
      }),
    );
    expect(connected.provider).toBe('sentry');
    // Verify runs AFTER the row is persisted.
    const connectOrder = connectSentryInstallation.mock.invocationCallOrder[0];
    const verifyOrder = vi.mocked(sentry.verifyInstallation).mock.invocationCallOrder[0];
    expect(connectOrder).toBeLessThan(verifyOrder ?? 0);
  });

  it('skips verifyInstallation when the flag is off', async () => {
    const sentry = sentryClient();
    const {result} = run({sentry, verifyInstall: false});

    await result;

    expect(sentry.verifyInstallation).not.toHaveBeenCalled();
  });

  it('returns the persisted connection when verify-install fails (non-fatal)', async () => {
    const sentry = sentryClient({
      verifyInstallation: vi.fn(() => Promise.reject(new Error('verify failed'))),
    });
    const {connectSentryInstallation, result} = run({sentry});

    const connected = await result;

    expect(connectSentryInstallation).toHaveBeenCalled();
    expect(connected.lifecycleStatus).toBe('active');
  });

  it('throws when the installation is linked to a different workspace', async () => {
    const sentry = sentryClient();
    const {result} = run({
      sentry,
      existing: connection({workspaceId: OTHER_WORKSPACE_ID}),
    });

    await expect(result).rejects.toBeInstanceOf(SentryInstallationAlreadyLinkedError);
    expect(sentry.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('is idempotent for an already-active same-workspace connection', async () => {
    const sentry = sentryClient();
    const existing = connection({workspaceId: WORKSPACE_ID, lifecycleStatus: 'active'});
    const {connectSentryInstallation, result} = run({sentry, existing});

    const connected = await result;

    expect(connected).toBe(existing);
    expect(sentry.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(connectSentryInstallation).not.toHaveBeenCalled();
  });

  it('re-activates a disabled same-workspace connection', async () => {
    const sentry = sentryClient();
    const existing = connection({workspaceId: WORKSPACE_ID, lifecycleStatus: 'disabled'});
    const {connectSentryInstallation, result} = run({sentry, existing});

    const connected = await result;

    expect(sentry.exchangeAuthorizationCode).toHaveBeenCalled();
    expect(connectSentryInstallation).toHaveBeenCalled();
    expect(connected.lifecycleStatus).toBe('active');
  });

  it('persists nothing when the code exchange fails', async () => {
    const sentry = sentryClient({
      exchangeAuthorizationCode: vi.fn(() => Promise.reject(new Error('forged code'))),
    });
    const {connectSentryInstallation, result} = run({sentry});

    await expect(result).rejects.toThrow('forged code');
    expect(sentry.getInstallation).not.toHaveBeenCalled();
    expect(connectSentryInstallation).not.toHaveBeenCalled();
    expect(sentry.verifyInstallation).not.toHaveBeenCalled();
  });
});
