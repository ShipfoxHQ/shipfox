import {
  formatManualRegistrationTokenDate,
  formatManualRegistrationTokenTimestamp,
  manualRegistrationTokenDisplayName,
} from './manual-registration-token-format.js';

describe('manualRegistrationTokenDisplayName', () => {
  test('uses the token name when present', () => {
    const result = manualRegistrationTokenDisplayName({name: 'Deploy runner'});

    expect(result).toBe('Deploy runner');
  });

  test('falls back for unnamed tokens', () => {
    const result = manualRegistrationTokenDisplayName({name: null});

    expect(result).toBe('Unnamed token');
  });
});

describe('formatManualRegistrationTokenDate', () => {
  test('formats timestamps as dates', () => {
    const result = formatManualRegistrationTokenDate('2026-05-08T00:00:00.000Z');

    expect(result).not.toBe('Never');
    expect(result).not.toContain(':');
  });

  test('formats null as never', () => {
    const result = formatManualRegistrationTokenDate(null);

    expect(result).toBe('Never');
  });
});

describe('formatManualRegistrationTokenTimestamp', () => {
  test('formats timestamps with time', () => {
    const result = formatManualRegistrationTokenTimestamp('2026-05-08T00:00:00.000Z');

    expect(result).toContain(':');
  });

  test('formats null as undefined', () => {
    const result = formatManualRegistrationTokenTimestamp(null);

    expect(result).toBeUndefined();
  });
});
