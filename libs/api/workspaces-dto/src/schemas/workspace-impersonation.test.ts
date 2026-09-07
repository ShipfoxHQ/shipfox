import {
  listWorkspaceAdminMembersResponseSchema,
  workspaceAdminLookupQuerySchema,
  workspaceAdminMemberSchema,
  workspaceAdminMembersParamsSchema,
  workspaceAdminMembersQuerySchema,
  workspaceAdminSummarySchema,
} from './workspace.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const createdAt = '2026-09-05T12:00:00.000Z';

const member = {
  id: USER_ID,
  email: 'alex@example.com',
  name: 'Alex Shipfox',
  status: 'active' as const,
  email_verified_at: createdAt,
  created_at: createdAt,
  admin_role: null,
};

const workspaceSummary = {
  id: WORKSPACE_ID,
  name: 'Acme',
  slug: 'acme',
  status: 'active' as const,
  member_summary: {count: 1},
  project_summary: {state: 'available' as const, count: 2},
  job_counts: {state: 'available' as const, queued: 1, running: 0},
  created_at: createdAt,
  updated_at: createdAt,
};

describe('administrator workspace collection contract', () => {
  it('keeps the existing collection query mode compatible', () => {
    expect(
      workspaceAdminLookupQuerySchema.parse({
        workspace_id: WORKSPACE_ID,
        status: 'suspended',
        limit: '10',
      }),
    ).toEqual({
      workspace_id: WORKSPACE_ID,
      status: 'suspended',
      limit: 10,
    });
  });

  it('accepts an exact slug without changing the ordinary page contract', () => {
    expect(workspaceAdminLookupQuerySchema.parse({workspace_slug: 'acme'})).toEqual({
      workspace_slug: 'acme',
      limit: 50,
    });
    expect(workspaceAdminSummarySchema.parse(workspaceSummary).slug).toBe('acme');
  });

  it.each([
    'workspace_id',
    'search',
    'cursor',
  ])('rejects workspace_slug with %s', (conflictingField) => {
    const query = {
      workspace_slug: 'acme',
      [conflictingField]: conflictingField === 'workspace_id' ? WORKSPACE_ID : 'value',
    };

    expect(workspaceAdminLookupQuerySchema.safeParse(query).success).toBe(false);
  });

  it('allows status with an exact slug because status does not widen the lookup', () => {
    expect(
      workspaceAdminLookupQuerySchema.parse({workspace_slug: 'acme', status: 'deleted'}),
    ).toMatchObject({workspace_slug: 'acme', status: 'deleted'});
  });
});

describe('administrator workspace member route contract', () => {
  it('keeps the resource path UUID-addressed', () => {
    expect(workspaceAdminMembersParamsSchema.parse({workspaceId: WORKSPACE_ID})).toEqual({
      workspaceId: WORKSPACE_ID,
    });
    expect(workspaceAdminMembersParamsSchema.safeParse({workspaceId: 'acme'}).success).toBe(false);
  });

  it('defaults paginated discovery to 25 members', () => {
    expect(workspaceAdminMembersQuerySchema.parse({})).toEqual({limit: 25});
    expect(
      workspaceAdminMembersQuerySchema.parse({
        search: '  alex@example.com  ',
        cursor: 'opaque-cursor',
        limit: '10',
      }),
    ).toEqual({search: 'alex@example.com', cursor: 'opaque-cursor', limit: 10});
  });

  it('treats blank search as omitted and keeps cursor pagination available', () => {
    expect(workspaceAdminMembersQuerySchema.parse({search: '   ', cursor: 'cursor'})).toEqual({
      cursor: 'cursor',
      limit: 25,
    });
  });

  it('accepts exact user lookup without a page limit', () => {
    expect(workspaceAdminMembersQuerySchema.parse({user_id: USER_ID})).toEqual({
      user_id: USER_ID,
    });
  });

  it.each([
    {search: 'alex'},
    {cursor: 'cursor'},
    {limit: '1'},
  ])('rejects exact user lookup with a paging field', (pagingField) => {
    expect(
      workspaceAdminMembersQuerySchema.safeParse({user_id: USER_ID, ...pagingField}).success,
    ).toBe(false);
  });

  it('enforces bounded search, cursor, and limit values', () => {
    expect(workspaceAdminMembersQuerySchema.safeParse({search: 'a'.repeat(128)}).success).toBe(
      true,
    );
    expect(workspaceAdminMembersQuerySchema.safeParse({search: 'a'.repeat(129)}).success).toBe(
      false,
    );
    expect(workspaceAdminMembersQuerySchema.safeParse({search: 'alex\u0000shipfox'}).success).toBe(
      false,
    );
    expect(workspaceAdminMembersQuerySchema.safeParse({cursor: 'a'.repeat(512)}).success).toBe(
      true,
    );
    expect(workspaceAdminMembersQuerySchema.safeParse({cursor: 'a'.repeat(513)}).success).toBe(
      false,
    );
    expect(workspaceAdminMembersQuerySchema.safeParse({limit: '1'}).success).toBe(true);
    expect(workspaceAdminMembersQuerySchema.safeParse({limit: '25'}).success).toBe(true);
    expect(workspaceAdminMembersQuerySchema.safeParse({limit: '26'}).success).toBe(false);
    expect(workspaceAdminMembersQuerySchema.safeParse({limit: '1e1'}).success).toBe(false);
  });

  it('rejects unknown route query fields', () => {
    expect(workspaceAdminMembersQuerySchema.safeParse({unexpected: 'value'}).success).toBe(false);
  });
});

describe('administrator workspace member response contract', () => {
  it('returns workspace identity, eligible members, and an opaque next cursor', () => {
    const response = listWorkspaceAdminMembersResponseSchema.parse({
      workspace_id: WORKSPACE_ID,
      workspace_slug: 'acme',
      workspace_name: 'Acme',
      workspace_status: 'active',
      members: [member],
      next_cursor: 'opaque-cursor',
    });

    expect(response.members).toEqual([member]);
    expect(workspaceAdminMemberSchema.parse(member)).toEqual(member);
  });

  it.each([
    'suspended',
    'deleted',
  ] as const)('represents %s workspaces without returning targets', (workspaceStatus) => {
    expect(
      listWorkspaceAdminMembersResponseSchema.parse({
        workspace_id: WORKSPACE_ID,
        workspace_slug: 'acme',
        workspace_name: 'Acme',
        workspace_status: workspaceStatus,
        members: [],
        next_cursor: null,
      }),
    ).toMatchObject({workspace_status: workspaceStatus, members: [], next_cursor: null});
  });

  it('rejects targets or cursors for inactive workspaces', () => {
    const inactiveResponse = {
      workspace_id: WORKSPACE_ID,
      workspace_slug: 'acme',
      workspace_name: 'Acme',
      workspace_status: 'suspended' as const,
      members: [member],
      next_cursor: null,
    };

    expect(listWorkspaceAdminMembersResponseSchema.safeParse(inactiveResponse).success).toBe(false);
    expect(
      listWorkspaceAdminMembersResponseSchema.safeParse({
        ...inactiveResponse,
        members: [],
        next_cursor: 'cursor',
      }).success,
    ).toBe(false);
  });

  it('allows an empty active page to carry a next cursor', () => {
    expect(
      listWorkspaceAdminMembersResponseSchema.safeParse({
        workspace_id: WORKSPACE_ID,
        workspace_slug: 'acme',
        workspace_name: 'Acme',
        workspace_status: 'active',
        members: [],
        next_cursor: 'cursor',
      }).success,
    ).toBe(true);
  });

  it('limits a response page to 25 members', () => {
    const members = Array.from({length: 25}, (_, index) => ({
      ...member,
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    }));

    expect(
      listWorkspaceAdminMembersResponseSchema.safeParse({
        workspace_id: WORKSPACE_ID,
        workspace_slug: 'acme',
        workspace_name: 'Acme',
        workspace_status: 'active',
        members,
        next_cursor: null,
      }).success,
    ).toBe(true);
    expect(
      listWorkspaceAdminMembersResponseSchema.safeParse({
        workspace_id: WORKSPACE_ID,
        workspace_slug: 'acme',
        workspace_name: 'Acme',
        workspace_status: 'active',
        members: [...members, member],
        next_cursor: null,
      }).success,
    ).toBe(false);
  });
});
