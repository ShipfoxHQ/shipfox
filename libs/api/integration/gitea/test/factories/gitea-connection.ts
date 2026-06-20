import {Factory} from 'fishery';
import {type GiteaConnection, upsertGiteaConnection} from '#db/connections.js';

export const giteaConnectionFactory = Factory.define<GiteaConnection>(({sequence, onCreate}) => {
  onCreate((connection) =>
    upsertGiteaConnection({
      connectionId: connection.connectionId,
      org: connection.org,
    }),
  );

  return {
    id: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    org: `org-${sequence + 1}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
