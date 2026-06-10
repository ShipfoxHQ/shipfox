import {Factory} from 'fishery';
import {type GithubInstallation, upsertGithubInstallation} from '#db/installations.js';

export const githubInstallationFactory = Factory.define<GithubInstallation>(
  ({sequence, onCreate}) => {
    onCreate((installation) =>
      upsertGithubInstallation({
        connectionId: installation.connectionId,
        installationId: installation.installationId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        repositorySelection: installation.repositorySelection,
        suspendedAt: installation.suspendedAt,
        deletedAt: installation.deletedAt,
        latestEvent: installation.latestEvent,
        installerUserId: installation.installerUserId,
      }),
    );

    return {
      id: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      installationId: `${sequence + 1}`,
      accountLogin: 'shipfox',
      accountType: 'Organization',
      repositorySelection: 'all',
      suspendedAt: null,
      deletedAt: null,
      latestEvent: {id: 1},
      installerUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },
);
