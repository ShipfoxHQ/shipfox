import {
  type PolicyNotice,
  policyNoticeSchema,
  type RequiredAction,
  requiredActionSchema,
} from './index.js';

describe('requiredActionSchema', () => {
  it('round trips a required action', () => {
    const requiredAction = {
      reason: 'workspace-limit',
      message: 'Add credits to continue.',
      url: '/settings/billing',
    } satisfies RequiredAction;

    expect(requiredActionSchema.parse(requiredAction)).toEqual(requiredAction);
  });
});

describe('policyNoticeSchema', () => {
  it('round trips a notice with a required action', () => {
    const notice = {
      reason: 'workspace-limit',
      message: 'This workspace cannot use that runner.',
      requiredAction: {
        reason: 'billing-payment-required',
        message: 'Add credits to use larger runners.',
        url: '/settings/billing',
      },
    } satisfies PolicyNotice;

    expect(policyNoticeSchema.parse(notice)).toEqual(notice);
  });

  it('round trips a notice without a required action', () => {
    const notice = {
      reason: 'workspace-limit',
      message: 'This workspace is at its limit.',
    } satisfies PolicyNotice;

    expect(policyNoticeSchema.parse(notice)).toEqual(notice);
  });

  it('rejects notices with incomplete required actions', () => {
    expect(
      policyNoticeSchema.safeParse({
        reason: 'workspace-limit',
        message: 'This workspace is at its limit.',
        requiredAction: {reason: 'billing-payment-required'},
      }).success,
    ).toBe(false);
  });
});
