import {allowedBudget} from './budget.js';

describe('allowedBudget', () => {
  const baseBytes = 5_242_880;
  const ratePerMinuteBytes = 1_048_576;

  it('returns the base at the clock origin', () => {
    const allowed = allowedBudget({baseBytes, ratePerMinuteBytes, elapsedMs: 0});

    expect(allowed).toBe(baseBytes);
  });

  it('adds the full rate after two minutes', () => {
    const allowed = allowedBudget({baseBytes, ratePerMinuteBytes, elapsedMs: 2 * 60_000});

    expect(allowed).toBe(baseBytes + 2 * ratePerMinuteBytes);
  });

  it('floors a partial minute', () => {
    const allowed = allowedBudget({baseBytes, ratePerMinuteBytes, elapsedMs: 90_000});

    expect(allowed).toBe(baseBytes + Math.floor(1.5 * ratePerMinuteBytes));
  });

  it('treats negative elapsed time as the origin', () => {
    const allowed = allowedBudget({baseBytes, ratePerMinuteBytes, elapsedMs: -10_000});

    expect(allowed).toBe(baseBytes);
  });
});
