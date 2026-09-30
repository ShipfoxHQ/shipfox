import {
  type PolicyNotice,
  policyNoticeSchema,
  REQUIRED_ACTION_INTENTS,
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

  it('round trips a required action with an intent', () => {
    const requiredAction = {
      reason: 'workspace-limit',
      message: 'Contact us',
      url: 'mailto:support@example.test',
      intent: REQUIRED_ACTION_INTENTS.contactSupport,
    } satisfies RequiredAction;

    expect(requiredActionSchema.parse(requiredAction)).toEqual(requiredAction);
  });

  it('parses an unknown intent', () => {
    const requiredAction = {
      reason: 'workspace-limit',
      message: 'Do something new',
      url: '/settings',
      intent: 'a-future-intent',
    };

    expect(requiredActionSchema.parse(requiredAction)).toEqual(requiredAction);
  });

  it('rejects a required action without a url', () => {
    expect(
      requiredActionSchema.safeParse({
        reason: 'workspace-limit',
        message: 'Contact us',
        intent: REQUIRED_ACTION_INTENTS.contactSupport,
      }).success,
    ).toBe(false);
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
