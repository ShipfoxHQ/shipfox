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
          repository_selection: 'selected',
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

  it('keeps the account id when present and parses without it', () => {
    expect(
      githubWebhookInstallationSchema.parse({
        installation: {id: 123, account: {id: 77, login: 'opsmill', type: 'Organization'}},
      }).installation?.account?.id,
    ).toBe(77);
    expect(
      githubWebhookInstallationSchema.parse({
        installation: {id: 123, account: {login: 'opsmill', type: 'Organization'}},
      }).installation?.account?.id,
    ).toBeUndefined();
  });

  it('accepts explicit null account, sender and requester', () => {
    expect(
      githubWebhookInstallationSchema.parse({
        installation: {id: 123, account: null},
        sender: null,
        requester: null,
      }),
    ).toMatchObject({installation: {id: 123}});
  });
});
