import {Factory} from 'fishery';
import {type NotionInstallation, upsertNotionInstallation} from '#db/installations.js';

export const notionInstallationFactory = Factory.define<NotionInstallation>(
  ({sequence, onCreate}) => {
    onCreate((installation) =>
      upsertNotionInstallation({
        connectionId: installation.connectionId,
        notionWorkspaceId: installation.notionWorkspaceId,
        workspaceName: installation.workspaceName,
        botId: installation.botId,
        authorizedByUserId: installation.authorizedByUserId,
        tokenExpiresAt: installation.tokenExpiresAt,
        status: installation.status,
      }),
    );

    return {
      id: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      notionWorkspaceId: crypto.randomUUID(),
      workspaceName: `Notion workspace ${sequence + 1}`,
      botId: crypto.randomUUID(),
      authorizedByUserId: crypto.randomUUID(),
      tokenExpiresAt: null,
      status: 'installed',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },
);
