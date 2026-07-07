import {
  LinearConnectionAlreadyLinkedError,
  LinearInstallationAlreadyLinkedError,
} from '#core/errors.js';
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

  it('refuses to claim an organization already linked to another connection', async () => {
    const organizationId = `org-${crypto.randomUUID()}`;
    const firstConnectionId = crypto.randomUUID();
    const secondConnectionId = crypto.randomUUID();
    await upsertLinearInstallation({
      connectionId: firstConnectionId,
      organizationId,
      organizationUrlKey: 'claimed',
      appUserId: 'app-user-claimed',
      scopes: ['read'],
      status: 'installed',
    });

    let error: unknown;
    try {
      await upsertLinearInstallation({
        connectionId: secondConnectionId,
        organizationId,
        organizationUrlKey: 'claimed',
        appUserId: 'app-user-claimed',
        scopes: ['read', 'write'],
        status: 'installed',
      });
    } catch (caught) {
      error = caught;
    }

    const installation = await getLinearInstallationByOrganizationId(organizationId);

    expect(error).toBeInstanceOf(LinearInstallationAlreadyLinkedError);
    expect(installation?.connectionId).toBe(firstConnectionId);
  });

  it('refuses to repoint an existing connection to another organization', async () => {
    const connectionId = crypto.randomUUID();
    const firstOrganizationId = `org-${crypto.randomUUID()}`;
    const secondOrganizationId = `org-${crypto.randomUUID()}`;
    await upsertLinearInstallation({
      connectionId,
      organizationId: firstOrganizationId,
      organizationUrlKey: 'first',
      appUserId: 'app-user-first',
      scopes: ['read'],
      status: 'installed',
    });

    let error: unknown;
    try {
      await upsertLinearInstallation({
        connectionId,
        organizationId: secondOrganizationId,
        organizationUrlKey: 'second',
        appUserId: 'app-user-second',
        scopes: ['read', 'write'],
        status: 'installed',
      });
    } catch (caught) {
      error = caught;
    }

    const installation = await getLinearInstallationByConnectionId(connectionId);

    expect(error).toBeInstanceOf(LinearConnectionAlreadyLinkedError);
    expect(installation?.organizationId).toBe(firstOrganizationId);
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
