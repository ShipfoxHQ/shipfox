import {
  ADMINISTRATION_ACTION_PERFORMED,
  ADMINISTRATION_AUTHORIZATION_BASES,
  type AdministrationActionEventMap,
  administrationActionEventSchema,
  administrationActionEventSchemas,
  administrationActionResultSchema,
  administrationAuthorizationBasisSchema,
  administrationRoleSchema,
  createAdministrationActionEvent,
  createAdministrationActionEventFixture,
} from './administration-action.js';

const eventInput = {
  actorId: '9b11d65a-f7e7-40ea-b421-06af012a9be5',
  actorRole: 'admin-operator' as const,
  requiredRole: 'admin-operator' as const,
  command: 'auth.user.suspend',
  targetType: 'user',
  targetId: 'c0a8012e-0b6d-4d8f-8d5c-6d74102602b0',
  reason: 'Requested by the support operator',
  result: 'succeeded' as const,
  correlationId: 'request-123',
  idempotencyKeyFingerprint: 'a'.repeat(64),
  occurredAt: '2026-07-26T12:00:00.000Z',
};

describe('administrationActionEventSchema', () => {
  it('constructs and round-trips a redacted administration action event', () => {
    const event = createAdministrationActionEvent(eventInput);
    const roundTripped = administrationActionEventSchema.parse(JSON.parse(JSON.stringify(event)));

    expect(roundTripped).toEqual(eventInput);
  });

  it('accepts each authorization basis shape', () => {
    const validEvents = [
      {...eventInput, authorizationBasis: 'current-role'},
      {...eventInput, authorizationBasis: 'current-role', actorRoleAtStart: 'admin-operator'},
      {
        ...eventInput,
        authorizationBasis: 'impersonation-window-owner',
        actorRole: null,
        requiredRole: null,
        actorRoleAtStart: 'admin-operator',
      },
      {
        ...eventInput,
        authorizationBasis: 'authorization-denied',
        actorRole: null,
        requiredRole: 'admin-operator',
        result: 'failed' as const,
      },
    ];

    for (const event of validEvents) {
      expect(administrationActionEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('rejects invalid authorization basis field combinations', () => {
    const invalidEvents = [
      {...eventInput, authorizationBasis: 'current-role', actorRole: null},
      {...eventInput, authorizationBasis: 'current-role', requiredRole: null},
      {...eventInput, authorizationBasis: 'current-role', actorRoleAtStart: null},
      {
        ...eventInput,
        authorizationBasis: 'impersonation-window-owner',
        actorRole: 'admin-operator',
        requiredRole: null,
        actorRoleAtStart: 'admin-operator',
      },
      {
        ...eventInput,
        authorizationBasis: 'impersonation-window-owner',
        actorRole: null,
        requiredRole: 'admin-operator',
        actorRoleAtStart: 'admin-operator',
      },
      {
        ...eventInput,
        authorizationBasis: 'impersonation-window-owner',
        actorRole: null,
        requiredRole: null,
      },
      {
        ...eventInput,
        authorizationBasis: 'authorization-denied',
        actorRole: 'admin-operator',
        requiredRole: 'admin-operator',
        result: 'failed' as const,
      },
      {
        ...eventInput,
        authorizationBasis: 'authorization-denied',
        actorRole: null,
        requiredRole: null,
        result: 'failed' as const,
      },
      {
        ...eventInput,
        authorizationBasis: 'authorization-denied',
        actorRole: null,
        requiredRole: 'admin-operator',
        result: 'succeeded' as const,
      },
      {...eventInput, actorRole: null},
      {...eventInput, authorizationBasis: 'unknown'},
    ];

    for (const event of invalidEvents) {
      expect(administrationActionEventSchema.safeParse(event).success).toBe(false);
    }
  });

  it('provides deterministic safe data for producer contract tests', () => {
    const event = createAdministrationActionEventFixture({result: 'failed'});

    expect(event).toMatchObject({
      authorizationBasis: 'current-role',
      command: 'auth.user.suspend',
      result: 'failed',
      idempotencyKeyFingerprint: 'a'.repeat(64),
    });
  });

  it.each([
    'token',
    'secret',
    'email',
    'databaseError',
  ])('rejects an uncontracted %s field', (field) => {
    const result = administrationActionEventSchema.safeParse({...eventInput, [field]: 'value'});

    expect(result.success).toBe(false);
  });

  it('rejects raw idempotency keys and malformed identifiers', () => {
    expect(
      administrationActionEventSchema.safeParse({
        ...eventInput,
        idempotencyKeyFingerprint: 'raw-idempotency-key',
      }).success,
    ).toBe(false);
    expect(
      administrationActionEventSchema.safeParse({...eventInput, command: 'User Suspend'}).success,
    ).toBe(false);
    expect(
      administrationActionEventSchema.safeParse({...eventInput, reason: 'line\nwith-break'})
        .success,
    ).toBe(false);
  });

  it('accepts only the fixed authorization bases, administrator roles, and safe action results', () => {
    for (const basis of ADMINISTRATION_AUTHORIZATION_BASES) {
      expect(administrationAuthorizationBasisSchema.safeParse(basis).success).toBe(true);
    }
    expect(administrationAuthorizationBasisSchema.safeParse('current-grant').success).toBe(false);
    for (const role of ['admin-observer', 'admin-operator', 'admin-owner']) {
      expect(administrationRoleSchema.safeParse(role).success).toBe(true);
    }
    expect(administrationRoleSchema.safeParse('admin-custom').success).toBe(false);
    expect(administrationActionResultSchema.safeParse('succeeded').success).toBe(true);
    expect(administrationActionResultSchema.safeParse('failed').success).toBe(true);
    expect(administrationActionResultSchema.safeParse('database-error').success).toBe(false);
  });

  it('exposes one schema for the shared outbox event map', () => {
    expect(Object.keys(administrationActionEventSchemas)).toEqual([
      ADMINISTRATION_ACTION_PERFORMED,
    ] satisfies Array<keyof AdministrationActionEventMap>);
  });
});
