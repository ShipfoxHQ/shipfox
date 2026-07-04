import {isValidCronExpression, isValidTimezone} from './cron-trigger.js';

describe('isValidCronExpression', () => {
  it.each([['0 2 * * *'], ['*/15 9-17 * * 1-5'], ['0 2 * * MON']])('accepts %s', (expression) => {
    const result = isValidCronExpression(expression);

    expect(result).toBe(true);
  });

  it.each([['0 0 2 * * *'], ['@daily'], ['   '], ['not a cron']])('rejects %s', (expression) => {
    const result = isValidCronExpression(expression);

    expect(result).toBe(false);
  });
});

describe('isValidTimezone', () => {
  it.each(['UTC', 'Europe/Paris', 'US/Pacific'])('accepts %s', (timezone) => {
    const result = isValidTimezone(timezone);

    expect(result).toBe(true);
  });

  it('rejects an unknown timezone', () => {
    const result = isValidTimezone('Not/A/Zone');

    expect(result).toBe(false);
  });
});
