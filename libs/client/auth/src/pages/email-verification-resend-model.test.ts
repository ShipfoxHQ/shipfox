import {EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS} from '@shipfox/api-auth-dto';
import {
  getLocalResendAvailableAt,
  getResendRemainingSeconds,
  parseNextResendAvailableAt,
} from './email-verification-resend-model.js';

describe('email verification resend model', () => {
  test('creates local cooldown targets from the shared cooldown', () => {
    const now = Date.UTC(2026, 4, 11, 12, 0, 0);

    const result = getLocalResendAvailableAt(now);

    expect(result).toBe(now + EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000);
  });

  test('rounds remaining cooldown seconds up for display', () => {
    const now = Date.UTC(2026, 4, 11, 12, 0, 0);

    const result = getResendRemainingSeconds({
      nextResendAvailableAt: now + 1_001,
      now,
    });

    expect(result).toBe(2);
  });

  test('does not return negative remaining cooldown seconds', () => {
    const now = Date.UTC(2026, 4, 11, 12, 0, 0);

    const result = getResendRemainingSeconds({
      nextResendAvailableAt: now - 1_000,
      now,
    });

    expect(result).toBe(0);
  });

  test('parses valid server cooldown timestamps', () => {
    const timestamp = '2026-05-11T12:01:00.000Z';

    const result = parseNextResendAvailableAt(timestamp);

    expect(result).toBe(Date.parse(timestamp));
  });

  test('ignores invalid server cooldown timestamps', () => {
    const result = parseNextResendAvailableAt('not-a-date');

    expect(result).toBeUndefined();
  });
});
