const testConfig = vi.hoisted(() => ({
  ADMIN_BOOTSTRAP_TOKEN: 'test-bootstrap-token',
  API_PUBLIC_URL: 'http://localhost:16101',
  AUTH_JWT_EXPIRES_IN: '15m',
  AUTH_IMPERSONATION_ENABLED: true,
  AUTH_JOB_LEASE_TOKEN_EXPIRES_IN: '90m',
  AUTH_RUNNER_SESSION_TOKEN_EXPIRES_IN: '1h',
  AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: 14,
  AUTH_REFRESH_ROTATION_GRACE_SECONDS: 30,
  AUTH_REFRESH_COOKIE_NAME: 'shipfox_refresh_token',
  AUTH_PASSWORD_ENABLED: true,
  AUTH_SIGNUP_GATE_ENABLED: false,
  AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS: '',
  AUTH_SIGNUP_ALLOWED_EMAILS: '',
  AUTH_SIGNUP_NOT_ALLOWED_MESSAGE: undefined,
  CLIENT_BASE_URL: 'https://app.example.test',
}));

vi.mock('#config.js', () => ({config: testConfig}));

import {authInterModuleContract} from '@shipfox/api-auth-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {createAdminGrant} from '#db/admin-grants.js';
import {userFactory} from '#test/index.js';
import {createAuthInterModulePresentation} from './inter-module.js';

function createClient() {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(authInterModuleContract);
  transport.register(createAuthInterModulePresentation());
  transport.seal();
  return client;
}

describe('Auth impersonation eligibility presentation', () => {
  it('returns only eligible safe summaries in requested ID order', async () => {
    const client = createClient();
    const eligible = await userFactory.create({emailVerifiedAt: new Date()});
    const ineligible = await userFactory.create({emailVerifiedAt: new Date()});
    await createAdminGrant({userId: ineligible.id, role: 'admin-observer'});

    const result = await client.listImpersonationEligibleUserSummaries({
      userIds: [ineligible.id, eligible.id],
      limit: 200,
    });

    expect(result).toEqual({
      users: [
        {
          id: eligible.id,
          email: eligible.email,
          name: eligible.name,
          status: eligible.status,
          emailVerifiedAt: eligible.emailVerifiedAt?.toISOString(),
          createdAt: eligible.createdAt.toISOString(),
          adminRole: null,
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify(result)).not.toContain('plainPassword');
  });

  it('returns an opaque deterministic search cursor for the next page', async () => {
    const client = createClient();
    const marker = `inter-module-search-${crypto.randomUUID()}`;
    const first = await userFactory.create({
      email: `${marker}-first@example.com`,
      emailVerifiedAt: new Date(),
    });
    const second = await userFactory.create({
      email: `${marker}-second@example.com`,
      emailVerifiedAt: new Date(),
    });
    const third = await userFactory.create({
      email: `${marker}-third@example.com`,
      emailVerifiedAt: new Date(),
    });

    const firstPage = await client.listImpersonationEligibleUserSummaries({
      search: marker,
      limit: 2,
    });
    const secondPage = await client.listImpersonationEligibleUserSummaries({
      search: marker,
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(firstPage.users).toHaveLength(2);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPage.nextCursor).not.toContain('createdAt');
    expect(secondPage.users).toHaveLength(1);
    expect(secondPage.users.map(({id}) => id)).toEqual([first.id]);
    expect(new Set([...firstPage.users, ...secondPage.users].map(({id}) => id))).toEqual(
      new Set([first.id, second.id, third.id]),
    );
    expect(secondPage.nextCursor).toBeNull();
  });

  it('rejects an invalid mode combination before the presentation runs', async () => {
    const client = createClient();
    const userId = crypto.randomUUID();

    await expect(
      client.listImpersonationEligibleUserSummaries({
        userIds: [userId],
        search: 'user',
        limit: 25,
      }),
    ).rejects.toThrow();
  });

  it('maps the disabled feature to the declared known error', async () => {
    const client = createClient();
    testConfig.AUTH_IMPERSONATION_ENABLED = false;

    const error = await client
      .listImpersonationEligibleUserSummaries({search: 'user', limit: 25})
      .catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(
        authInterModuleContract.methods.listImpersonationEligibleUserSummaries,
        error,
      ),
    ).toBe(true);
    if (
      isInterModuleKnownError(
        authInterModuleContract.methods.listImpersonationEligibleUserSummaries,
        error,
      )
    ) {
      expect(error.code).toBe('impersonation-disabled');
      expect(error.details).toEqual({});
    }

    testConfig.AUTH_IMPERSONATION_ENABLED = true;
  });
});
