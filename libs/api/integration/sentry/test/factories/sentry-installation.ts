import {Factory} from 'fishery';
import {
  type SentryInstallation,
  type SentryInstallationStatus,
  upsertSentryInstallation,
} from '#db/installations.js';

export const sentryInstallationFactory = Factory.define<SentryInstallation>(
  ({sequence, onCreate}) => {
    onCreate((installation) =>
      upsertSentryInstallation({
        connectionId: installation.connectionId,
        installationUuid: installation.installationUuid,
        orgSlug: installation.orgSlug,
        status: installation.status as SentryInstallationStatus,
        installerUserId: installation.installerUserId,
      }),
    );

    return {
      id: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      installationUuid: `install-${sequence + 1}`,
      orgSlug: 'acme',
      status: 'installed',
      installerUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },
);
