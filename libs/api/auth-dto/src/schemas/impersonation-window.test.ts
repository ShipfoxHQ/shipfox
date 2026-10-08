import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  impersonateResponseSchema,
  impersonationWindowContinueBodySchema,
  impersonationWindowContinueResponseSchema,
  impersonationWindowDeadlineReachedErrorSchema,
  impersonationWindowExactResponseSchema,
  impersonationWindowLimitReachedErrorSchema,
  impersonationWindowNotFoundErrorSchema,
  impersonationWindowParamsSchema,
  impersonationWindowStartBodySchema,
  impersonationWindowStartResponseSchema,
  impersonationWindowStopBodySchema,
  impersonationWindowStoppedErrorSchema,
  impersonationWindowStopResponseSchema,
  impersonationWindowsQuerySchema,
  impersonationWindowsResponseSchema,
  impersonationWorkspaceNotActiveErrorSchema,
} from './index.js';

const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'operator@example.test',
  name: 'Operator',
  status: 'active' as const,
  email_verified_at: '2026-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  admin_role: 'admin-operator' as const,
};
const target = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'target@example.test',
  name: 'Target',
  status: 'active' as const,
  email_verified_at: '2026-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  admin_role: null,
};
const windowId = '33333333-3333-4333-8333-333333333333';
const workspaceId = '44444444-4444-4444-8444-444444444444';
const startedAt = '2026-01-01T00:00:00.000Z';
const deadlineAt = '2026-01-01T01:00:00.000Z';

const tokenResponse = {
  token: 'token',
  expires_at: '2026-01-01T00:15:00.000Z',
  server_time: startedAt,
  impersonator_id: actor.id,
  user: {
    id: target.id,
    email: target.email,
    name: target.name,
    status: target.status,
    email_verified_at: target.email_verified_at,
    created_at: target.created_at,
    updated_at: target.created_at,
  },
  workspace_id: workspaceId,
  window_id: windowId,
  window_started_at: startedAt,
  window_deadline: deadlineAt,
};

const windowSummary = {
  window_id: windowId,
  actor,
  workspace_id: workspaceId,
  target: null,
  reason: 'Support is investigating a user-provided run link',
  started_at: startedAt,
  deadline_at: deadlineAt,
};

describe('impersonation window DTOs', () => {
  it('keeps the legacy impersonation response separate from window responses', () => {
    const legacy = {
      token: 'token',
      expires_at: '2026-01-01T00:15:00.000Z',
      server_time: startedAt,
      impersonator_id: actor.id,
      user: tokenResponse.user,
    };

    expect(impersonateResponseSchema.parse(legacy)).toEqual(legacy);
    expect(impersonationWindowStartResponseSchema.parse(tokenResponse)).toEqual(tokenResponse);
    expect(impersonationWindowContinueResponseSchema.parse(tokenResponse)).toEqual(tokenResponse);
  });

  it('validates the separate Start, Continue, and Stop command shapes', () => {
    expect(
      impersonationWindowStartBodySchema.parse({
        workspace_id: workspaceId,
        reason: 'Investigate a support link',
      }),
    ).toEqual({
      workspace_id: workspaceId,
      reason: 'Investigate a support link',
    });
    expect(impersonationWindowStartBodySchema.parse({workspace_id: workspaceId})).toEqual({
      workspace_id: workspaceId,
    });
    expect(impersonationWindowStartBodySchema.safeParse({target_user_id: target.id}).success).toBe(
      false,
    );
    expect(impersonationWindowContinueBodySchema.parse(undefined)).toEqual({});
    expect(impersonationWindowParamsSchema.parse({windowId})).toEqual({windowId});
    expect(impersonationWindowStopBodySchema.parse(undefined)).toEqual({});
    expect(impersonationWindowStopBodySchema.parse({reason: 'Finished investigating'})).toEqual({
      reason: 'Finished investigating',
    });
    expect(
      impersonationWindowStartBodySchema.safeParse({
        workspace_id: workspaceId,
        reason: '   ',
      }).success,
    ).toBe(false);
    expect(impersonationWindowStopBodySchema.safeParse({reason: '   '}).success).toBe(false);
  });

  it('returns a null reason for windows opened without one', () => {
    expect(
      impersonationWindowsResponseSchema.parse({
        windows: [{...windowSummary, reason: null}],
        next_cursor: null,
      }).windows[0]?.reason,
    ).toBeNull();
  });

  it('keeps the target for windows opened before windows targeted a workspace', () => {
    const legacy = {...windowSummary, workspace_id: null, target};

    expect(
      impersonationWindowsResponseSchema.parse({windows: [legacy], next_cursor: null}).windows[0],
    ).toMatchObject({workspace_id: null, target: {id: target.id}});
  });

  it('defaults and bounds collection reads', () => {
    expect(impersonationWindowsQuerySchema.parse({})).toEqual({
      scope: 'owned',
      limit: 50,
    });
    expect(impersonationWindowsQuerySchema.parse({scope: 'all', limit: '100'})).toEqual({
      scope: 'all',
      limit: 100,
    });
    expect(impersonationWindowsQuerySchema.safeParse({limit: '101'}).success).toBe(false);
    expect(impersonationWindowsQuerySchema.safeParse({scope: 'other'}).success).toBe(false);
  });

  it('redacts no credential material from collection and exact-read metadata', () => {
    expect(
      impersonationWindowsResponseSchema.parse({windows: [windowSummary], next_cursor: null}),
    ).toEqual({windows: [windowSummary], next_cursor: null});
    expect(
      impersonationWindowExactResponseSchema.parse({
        ...windowSummary,
        actor_role_at_start: 'admin-owner',
        state: 'open',
        ended_at: null,
        ended_reason: null,
      }),
    ).toMatchObject({
      window_id: windowId,
      actor: {admin_role: 'admin-operator'},
      actor_role_at_start: 'admin-owner',
      state: 'open',
    });
  });

  it('keeps terminal state and reason pairs aligned', () => {
    expect(
      impersonationWindowExactResponseSchema.parse({
        ...windowSummary,
        actor_role_at_start: 'admin-owner',
        state: 'stopped',
        ended_at: deadlineAt,
        ended_reason: 'stopped',
      }),
    ).toMatchObject({state: 'stopped', ended_reason: 'stopped'});
    expect(
      impersonationWindowStopResponseSchema.parse({
        window_id: windowId,
        state: 'expired',
        ended_at: deadlineAt,
      }),
    ).toEqual({window_id: windowId, state: 'expired', ended_at: deadlineAt});
    expect(
      impersonationWindowExactResponseSchema.safeParse({
        ...windowSummary,
        actor_role_at_start: 'admin-owner',
        state: 'expired',
        ended_at: deadlineAt,
        ended_reason: 'stopped',
      }).success,
    ).toBe(false);
  });

  it.each([
    [impersonationWindowNotFoundErrorSchema, 'impersonation-window-not-found'],
    [impersonationWindowStoppedErrorSchema, 'impersonation-window-stopped'],
    [impersonationWindowDeadlineReachedErrorSchema, 'impersonation-window-deadline-reached'],
    [impersonationWindowLimitReachedErrorSchema, 'impersonation-window-limit-reached'],
    [impersonationWorkspaceNotActiveErrorSchema, 'impersonation-workspace-not-active'],
  ])('provides a Fastify-compatible schema for %s', (schema, code) => {
    expect(schema.parse({code})).toEqual({code});
  });
});
