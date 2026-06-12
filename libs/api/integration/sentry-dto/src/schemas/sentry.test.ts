import {sentryConnectBodySchema} from './sentry.js';

describe('sentryConnectBodySchema', () => {
  test('accepts a valid connect tuple', () => {
    const body = {
      workspace_id: '11111111-1111-4111-8111-111111111111',
      code: 'install-code',
      installation_id: 'install-uuid-1',
    };

    const parsed = sentryConnectBodySchema.parse(body);

    expect(parsed.installation_id).toBe('install-uuid-1');
  });

  test('rejects a missing code', () => {
    const body = {
      workspace_id: '11111111-1111-4111-8111-111111111111',
      installation_id: 'install-uuid-1',
    };

    const result = sentryConnectBodySchema.safeParse(body);

    expect(result.success).toBe(false);
  });

  test('rejects a non-uuid workspace_id', () => {
    const body = {
      workspace_id: 'not-a-uuid',
      code: 'install-code',
      installation_id: 'install-uuid-1',
    };

    const result = sentryConnectBodySchema.safeParse(body);

    expect(result.success).toBe(false);
  });

  test('rejects an empty installation_id', () => {
    const body = {
      workspace_id: '11111111-1111-4111-8111-111111111111',
      code: 'install-code',
      installation_id: '',
    };

    const result = sentryConnectBodySchema.safeParse(body);

    expect(result.success).toBe(false);
  });

  test('does not accept org_slug into the parsed body', () => {
    const body = {
      workspace_id: '11111111-1111-4111-8111-111111111111',
      code: 'install-code',
      installation_id: 'install-uuid-1',
      org_slug: 'acme',
    };

    const parsed = sentryConnectBodySchema.parse(body);

    expect('org_slug' in parsed).toBe(false);
  });
});
