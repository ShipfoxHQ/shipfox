import {StepOverlap} from '#core/step-overlap.js';

describe('StepOverlap', () => {
  it('counts a step that ran alone as one', () => {
    const overlap = new StepOverlap();

    const first = overlap.begin();
    first.end();
    const second = overlap.begin();

    expect(first.count()).toBe(1);
    expect(second.count()).toBe(1);
  });

  it('counts every step that ran during a span, including ones that already ended', () => {
    const overlap = new StepOverlap();
    const long = overlap.begin();
    const early = overlap.begin();
    early.end();
    const late = overlap.begin();

    long.end();
    late.end();

    expect(long.count()).toBe(3);
    expect(early.count()).toBe(2);
    expect(late.count()).toBe(2);
  });
});
