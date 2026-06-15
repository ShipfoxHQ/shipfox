import {Factory} from 'fishery';
import {
  persistVerifiedUnclaimedInstallation,
  type SentryInstallation,
  type SentryInstallationStatus,
  upsertSentryInstallation,
} from '#db/installations.js';

// Persists either a claimed install (default: `connectionId` set) or, when
// `connectionId` is null, a verified-unclaimed install via the dedicated insert
// so tests can exercise the webhook-authoritative pre-claim state.
export const sentryInstallationFactory = Factory.define<SentryInstallation>(
  ({sequence, onCreate}) => {
    onCreate((installation) => {
      if (installation.connectionId === null) {
        return persistVerifiedUnclaimedInstallation({
          installationUuid: installation.installationUuid,
          orgSlug: installation.orgSlug,
          codeHash: installation.codeHash ?? 'unclaimed-code-hash',
        });
      }
      return upsertSentryInstallation({
        connectionId: installation.connectionId,
        installationUuid: installation.installationUuid,
        orgSlug: installation.orgSlug,
        status: installation.status as SentryInstallationStatus,
        codeHash: installation.codeHash,
        installerUserId: installation.installerUserId,
      });
    });

    return {
      id: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      installationUuid: `install-${sequence + 1}`,
      orgSlug: 'acme',
      status: 'installed',
      codeHash: null,
      installerUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },
);
