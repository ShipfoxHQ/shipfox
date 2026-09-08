import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  authInterModuleContract,
  IMPERSONATION_ELIGIBILITY_MAX_PAGE_SIZE,
  IMPERSONATION_ELIGIBILITY_MAX_USER_IDS,
} from './inter-module.js';

const method = authInterModuleContract.methods.listImpersonationEligibleUserSummaries;
const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const summary = {
  id: userId,
  email: 'alex@example.com',
  name: 'Alex Shipfox',
  status: 'active' as const,
  emailVerifiedAt: '2026-08-31T12:00:00.000Z',
  createdAt: '2026-08-01T12:00:00.000Z',
  adminRole: null,
};

const parseInput = (input: unknown) => method.input.safeParse(input);

describe('Auth impersonation eligibility inter-module contract', () => {
  it('accepts bounded ID and search modes', () => {
    expect(
      parseInput({
        userIds: Array.from({length: IMPERSONATION_ELIGIBILITY_MAX_USER_IDS}, () => userId),
        limit: IMPERSONATION_ELIGIBILITY_MAX_PAGE_SIZE,
      }).success,
    ).toBe(true);
    expect(parseInput({search: 'alex', limit: 25}).success).toBe(true);
    expect(parseInput({userIds: [], limit: 25}).success).toBe(true);
    expect(
      parseInput({
        search: 'alex',
        cursor: 'eyJtb2RlIjoic2VhcmNoIn0',
        limit: 25,
      }).success,
    ).toBe(true);
  });

  it('rejects requests without exactly one meaningful lookup mode', () => {
    expect(parseInput({limit: 25}).success).toBe(false);
    expect(parseInput({search: '   ', limit: 25}).success).toBe(false);
    expect(parseInput({cursor: 'cursor', limit: 25}).success).toBe(false);
  });

  it('rejects mixed modes and values outside the lookup bounds', () => {
    expect(
      parseInput({
        userIds: [userId],
        search: 'alex',
        limit: 25,
      }).success,
    ).toBe(false);
    expect(
      parseInput({
        userIds: [userId],
        cursor: 'cursor',
        limit: 25,
      }).success,
    ).toBe(false);
    expect(
      parseInput({
        userIds: Array.from({length: IMPERSONATION_ELIGIBILITY_MAX_USER_IDS + 1}, () => userId),
        limit: 25,
      }).success,
    ).toBe(false);
    expect(parseInput({search: 'alex', limit: 0}).success).toBe(false);
    expect(
      parseInput({search: 'alex', limit: IMPERSONATION_ELIGIBILITY_MAX_PAGE_SIZE + 1}).success,
    ).toBe(false);
  });

  it('rejects unsafe cursor and search values', () => {
    expect(parseInput({search: 'alex\nshipfox', limit: 25}).success).toBe(false);
    expect(parseInput({cursor: 'cursor\u200Bvalue', limit: 25}).success).toBe(false);
    expect(parseInput({search: 'a'.repeat(257), limit: 25}).success).toBe(false);
    expect(
      parseInput({
        search: Array.from({length: 11}, () => 'term').join(' '),
        limit: 25,
      }).success,
    ).toBe(false);
    expect(parseInput({search: 'a'.repeat(101), limit: 25}).success).toBe(false);
  });

  it('defines empty known errors and a redacted summary output', () => {
    expect(method.errors['impersonation-disabled'].parse({})).toEqual({});
    expect(method.errors['invalid-cursor'].parse({})).toEqual({});
    expect(
      method.output.parse({
        users: [
          {
            ...summary,
            hashedPassword: 'must-not-cross-the-boundary',
            refreshToken: 'must-not-cross-the-boundary',
          },
        ],
        nextCursor: null,
      }),
    ).toEqual({users: [summary], nextCursor: null});
    expect(
      method.output.parse({
        users: [summary, {...summary, id: otherUserId}],
        nextCursor: 'opaque-cursor',
      }).users,
    ).toHaveLength(2);
  });
});
