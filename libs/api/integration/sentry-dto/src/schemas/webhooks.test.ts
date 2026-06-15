import {sentryInstallationWebhookSchema, sentryIssueWebhookSchema} from './webhooks.js';

describe('sentryIssueWebhookSchema', () => {
  test('parses a realistic issue webhook with extra fields, stripping unknown keys', () => {
    const body = {
      action: 'created',
      actor: {type: 'application', id: 'sentry', name: 'Sentry'},
      installation: {uuid: 'install-uuid-1', extra: 'ignored'},
      data: {
        issue: {
          id: 'issue-123',
          shortId: 'PROJ-1',
          title: 'TypeError: undefined is not a function',
          culprit: 'app/main',
          level: 'error',
          status: 'unresolved',
          platform: 'javascript',
          web_url: 'https://sentry.io/organizations/acme/issues/123/',
          url: 'https://sentry.io/api/0/issues/123/',
          project_url: 'https://sentry.io/api/0/projects/acme/web/',
          firstSeen: '2026-06-01T00:00:00Z',
          lastSeen: '2026-06-10T00:00:00Z',
          metadata: {value: 'unread field'},
        },
      },
    };

    const parsed = sentryIssueWebhookSchema.parse(body);

    expect(parsed.action).toBe('created');
    expect(parsed.installation.uuid).toBe('install-uuid-1');
    expect(parsed.data.issue.id).toBe('issue-123');
    expect(parsed.data.issue.web_url).toBe('https://sentry.io/organizations/acme/issues/123/');
  });

  test('coerces a numeric issue id to a string', () => {
    const body = {
      action: 'resolved',
      installation: {uuid: 'install-uuid-1'},
      data: {issue: {id: 456}},
    };

    const parsed = sentryIssueWebhookSchema.parse(body);

    expect(parsed.data.issue.id).toBe('456');
  });

  test('accepts explicit nulls on optional issue fields instead of dropping the delivery', () => {
    const body = {
      action: 'created',
      installation: {uuid: 'install-uuid-1'},
      data: {
        issue: {
          id: 'issue-123',
          shortId: null,
          culprit: null,
          level: null,
          status: null,
          platform: null,
          web_url: null,
          url: null,
          project_url: null,
          firstSeen: null,
          lastSeen: null,
        },
      },
    };

    const result = sentryIssueWebhookSchema.safeParse(body);

    expect(result.success).toBe(true);
  });

  test('rejects a payload missing installation.uuid', () => {
    const body = {
      action: 'created',
      installation: {},
      data: {issue: {id: 'issue-1'}},
    };

    const result = sentryIssueWebhookSchema.safeParse(body);

    expect(result.success).toBe(false);
  });

  test('rejects an action outside the accepted enum (route handles it as record-and-drop)', () => {
    const body = {
      action: 'ignored',
      installation: {uuid: 'install-uuid-1'},
      data: {issue: {id: 'issue-1'}},
    };

    const result = sentryIssueWebhookSchema.safeParse(body);

    expect(result.success).toBe(false);
  });
});

describe('sentryInstallationWebhookSchema', () => {
  test('parses a created installation envelope with uuid, org slug, status, and code', () => {
    const body = {
      action: 'created',
      actor: {type: 'user', id: 42, name: 'Ada'},
      data: {
        installation: {
          uuid: 'install-uuid-1',
          status: 'installed',
          code: 'grant-code-1',
          organization: {slug: 'acme'},
          extra: 'ignored',
        },
      },
    };

    const parsed = sentryInstallationWebhookSchema.parse(body);

    expect(parsed.action).toBe('created');
    expect(parsed.data.installation.uuid).toBe('install-uuid-1');
    expect(parsed.data.installation.organization?.slug).toBe('acme');
    expect(parsed.data.installation.code).toBe('grant-code-1');
  });

  test('tolerates a missing status, actor, code, and organization', () => {
    const body = {action: 'deleted', data: {installation: {uuid: 'install-uuid-1'}}};

    const parsed = sentryInstallationWebhookSchema.parse(body);

    expect(parsed.action).toBe('deleted');
    expect(parsed.data.installation.uuid).toBe('install-uuid-1');
    expect(parsed.data.installation.code).toBeUndefined();
  });

  test('rejects an unknown installation action', () => {
    const body = {action: 'suspended', data: {installation: {uuid: 'install-uuid-1'}}};

    const result = sentryInstallationWebhookSchema.safeParse(body);

    expect(result.success).toBe(false);
  });

  test('rejects a payload missing data.installation.uuid', () => {
    const body = {action: 'created', data: {installation: {}}};

    const result = sentryInstallationWebhookSchema.safeParse(body);

    expect(result.success).toBe(false);
  });
});
