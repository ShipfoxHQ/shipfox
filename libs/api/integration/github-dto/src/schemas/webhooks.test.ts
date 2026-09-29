import {githubWebhookInstallationSchema} from './webhooks.js';

describe('githubWebhookInstallationSchema', () => {
  it('accepts minimal installation payloads', () => {
    expect(githubWebhookInstallationSchema.parse({installation: {id: 123}})).toEqual({
      installation: {id: 123},
    });
  });

  it('accepts account, sender and requester details', () => {
    expect(
      githubWebhookInstallationSchema.parse({
        action: 'created',
        installation: {
          id: 123,
          account: {login: 'opsmill', type: 'Organization'},
        },
        sender: {login: 'octocat'},
        requester: {login: 'member'},
      }),
    ).toMatchObject({
      installation: {account: {login: 'opsmill', type: 'Organization'}},
      sender: {login: 'octocat'},
      requester: {login: 'member'},
    });
  });
});
