import {Factory} from 'fishery';
import {type ClickUpInstallation, upsertClickUpInstallation} from '#db/installations.js';

export const clickupInstallationFactory = Factory.define<ClickUpInstallation>(
  ({sequence, onCreate}) => {
    onCreate((installation) =>
      upsertClickUpInstallation({
        connectionId: installation.connectionId,
        teamId: installation.teamId,
        teamName: installation.teamName,
        authorizingUserId: installation.authorizingUserId,
        webhookId: installation.webhookId,
        status: installation.status,
      }),
    );

    return {
      id: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      teamId: `clickup-team-${sequence + 1}`,
      teamName: 'Acme',
      authorizingUserId: `clickup-user-${sequence + 1}`,
      webhookId: `webhook-${sequence + 1}`,
      status: 'installed',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },
);
