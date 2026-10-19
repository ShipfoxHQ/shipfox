import {
  findProjectsInputSchema,
  findUsersInputSchema,
  findWorkspacesInputSchema,
  startImpersonationInputSchema,
  stopImpersonationInputSchema,
} from './admin-tools.js';

describe('admin tool inputs', () => {
  test('find_users defaults the limit and trims nothing', () => {
    expect(findUsersInputSchema.parse({search: 'ada'})).toEqual({search: 'ada', limit: 10});
  });

  test.each([
    {search: ''},
    {search: '   '},
    {search: 'a b c d e f g h i j k'},
    {search: 'x'.repeat(101)},
    {search: 'ada\u0000'},
    {search: 'ada', limit: 26},
    {search: 'ada', extra: true},
    {},
  ])('find_users rejects %j', (input) => {
    expect(findUsersInputSchema.safeParse(input).success).toBe(false);
  });

  test('find_workspaces and find_projects list everything when no search is given', () => {
    expect(findWorkspacesInputSchema.parse({})).toEqual({limit: 10});
    expect(findProjectsInputSchema.parse({})).toEqual({limit: 10});
  });

  test('find_workspaces trims the search and accepts a status filter', () => {
    expect(findWorkspacesInputSchema.parse({search: ' acme ', status: 'suspended'})).toEqual({
      search: 'acme',
      status: 'suspended',
      limit: 10,
    });
  });

  test('find_workspaces accepts a cursor longer than the fixed-size cursors', () => {
    const cursor = 'x'.repeat(2000);

    expect(findWorkspacesInputSchema.parse({cursor})).toEqual({cursor, limit: 10});
  });

  test.each([
    {search: ''},
    {search: '   '},
    {search: 'x'.repeat(101)},
    {search: 'acme\u0000'},
    {limit: 26},
    {status: 'archived'},
    {extra: true},
  ])('find_workspaces rejects %j', (input) => {
    expect(findWorkspacesInputSchema.safeParse(input).success).toBe(false);
  });

  test.each([
    {search: ''},
    {search: 'x'.repeat(101)},
    {limit: 0},
    {status: 'active'},
  ])('find_projects rejects %j', (input) => {
    expect(findProjectsInputSchema.safeParse(input).success).toBe(false);
  });

  test.each([
    startImpersonationInputSchema,
    stopImpersonationInputSchema,
  ])('window tools require a workspace uuid and nothing else', (schema) => {
    const workspaceId = '33333333-3333-4333-8333-333333333333';

    expect(schema.safeParse({workspace_id: workspaceId}).success).toBe(true);
    expect(schema.safeParse({workspace_id: 'acme'}).success).toBe(false);
    expect(schema.safeParse({workspace_id: workspaceId, reason: 'x'}).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });
});
