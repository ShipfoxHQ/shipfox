import {
  WORKSPACES_INVITATION_SEND_REQUESTED,
  WORKSPACES_WORKSPACE_CREATED,
  workspacesEventSchemas,
} from '@shipfox/api-workspaces-dto';
import {workspacesModule} from './index.js';

vi.mock('#config.js', () => ({
  config: {
    CLIENT_BASE_URL: 'https://app.example.test',
  },
}));

vi.mock('@shipfox/node-mailer', () => ({
  mailer: {send: vi.fn()},
}));

describe('workspacesModule', () => {
  test('registers workspace outbox publisher and invitation subscriber', () => {
    const publisher = workspacesModule.publishers?.find((pub) => pub.name === 'workspaces');
    const events = workspacesModule.subscribers?.map((subscriber) => subscriber.event);

    expect(publisher?.eventSchemas).toBe(workspacesEventSchemas);
    expect(Object.keys(publisher?.eventSchemas ?? {})).toEqual([
      WORKSPACES_INVITATION_SEND_REQUESTED,
      WORKSPACES_WORKSPACE_CREATED,
    ]);
    expect(events).toContain(WORKSPACES_INVITATION_SEND_REQUESTED);
  });
});
