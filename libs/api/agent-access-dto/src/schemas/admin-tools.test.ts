import {
  findUsersInputSchema,
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
