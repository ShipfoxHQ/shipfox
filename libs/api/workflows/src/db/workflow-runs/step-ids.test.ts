import {uuidv7, withStepIds} from './step-ids.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('step ids', () => {
  test('makes time-ordered version 7 ids', () => {
    const earlier = uuidv7(Date.UTC(2026, 9, 15));
    const later = uuidv7(Date.UTC(2026, 9, 15) + 1);

    expect(earlier).toMatch(UUID_V7);
    expect(earlier.slice(0, 13)).toBe('01a13cdb-cc00');
    expect(later > earlier).toBe(true);
  });

  test('points each inner row at the id of its composite row', () => {
    const rows = withStepIds([
      {position: 1, parentPosition: null},
      {position: 2, parentPosition: 1},
      {position: 3, parentPosition: null},
    ]);

    expect(rows.map((row) => row.parentStepId)).toEqual([null, rows[0]?.id, null]);
    expect(rows.every((row) => UUID_V7.test(row.id))).toBe(true);
  });
});
