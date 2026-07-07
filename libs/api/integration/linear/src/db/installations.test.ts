import {
  getLinearInstallationByConnectionId,
  getLinearInstallationByOrganizationId,
  markLinearInstallationRevoked,
  upsertLinearInstallation,
} from './installations.js';

describe('linear installations', () => {
  it('upserts and reads an installation by connection id', async () => {
    const connectionId = crypto.randomUUID();
    const organizationId = `org-${crypto.randomUUID()}`;
    const tokenExpiresAt = new Date('2026-08-01T00:00:00.000Z');

    const installation = await upsertLinearInstallation({
      connectionId,
      organizationId,
      organizationUrlKey: 'acme',
      appUserId: 'app-user-1',
      scopes: ['read', 'write'],
      tokenExpiresAt,
      status: 'installed',
    });

    const result = await getLinearInstallationByConnectionId(connectionId);
    expect(result).toEqual(installation);
  });

  it('updates mutable metadata for an existing connection id', async () => {
    const connectionId = crypto.randomUUID();
    const organizationId = `org-${crypto.randomUUID()}`;
    await upsertLinearInstallation({
      connectionId,
      organizationId,
      organizationUrlKey: 'old',
      appUserId: 'app-user-2',
      scopes: ['read'],
      status: 'installed',
    });

    const result = await upsertLinearInstallation({
      connectionId,
      organizationId,
      organizationUrlKey: 'new',
      appUserId: 'app-user-3',
      scopes: ['read', 'write', 'app:assignable'],
      tokenExpiresAt: null,
      status: 'installed',
    });

    expect(result.organizationUrlKey).toBe('new');
    expect(result.appUserId).toBe('app-user-3');
    expect(result.scopes).toEqual(['read', 'write', 'app:assignable']);
  });

  it('reads an installation by organization id', async () => {
    const connectionId = crypto.randomUUID();
    const organizationId = `org-${crypto.randomUUID()}`;
    await upsertLinearInstallation({
      connectionId,
      organizationId,
      organizationUrlKey: 'lookup',
      appUserId: 'app-user-lookup',
      scopes: ['read'],
      status: 'installed',
    });

    const result = await getLinearInstallationByOrganizationId(organizationId);

    expect(result?.connectionId).toBe(connectionId);
  });

  it('marks an installation revoked by connection id', async () => {
    const connectionId = crypto.randomUUID();
    await upsertLinearInstallation({
      connectionId,
      organizationId: `org-${crypto.randomUUID()}`,
      organizationUrlKey: 'revoked',
      appUserId: 'app-user-revoked',
      scopes: ['read'],
      status: 'installed',
    });

    const result = await markLinearInstallationRevoked(connectionId);

    expect(result?.status).toBe('revoked');
  });
});
