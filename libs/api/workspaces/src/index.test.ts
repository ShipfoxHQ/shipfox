import {
  WORKSPACES_INVITATION_SEND_REQUESTED,
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
  test('registers workspace invitation outbox publisher and subscriber', () => {
    const publisher = workspacesModule.publishers?.find((pub) => pub.name === 'workspaces');
    const events = workspacesModule.subscribers?.map((subscriber) => subscriber.event);

    expect(publisher?.eventSchemas).toBe(workspacesEventSchemas);
    expect(Object.keys(publisher?.eventSchemas ?? {})).toEqual([
      WORKSPACES_INVITATION_SEND_REQUESTED,
    ]);
    expect(events).toContain(WORKSPACES_INVITATION_SEND_REQUESTED);
  });
});
