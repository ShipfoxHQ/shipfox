import {createInMemoryTracker} from '#tracker.js';

describe('createInMemoryTracker', () => {
  it('counts starting runners per template', () => {
    const tracker = createInMemoryTracker();

    tracker.recordStarting({providerRunnerId: 'a', templateKey: 'small'});
    tracker.recordStarting({providerRunnerId: 'b', templateKey: 'small'});
    tracker.recordStarting({providerRunnerId: 'c', templateKey: 'big'});

    expect(tracker.countsByTemplate()).toEqual(
      new Map([
        ['small', {starting: 2, running: 0}],
        ['big', {starting: 1, running: 0}],
      ]),
    );
  });

  it('moves a runner from starting to running', () => {
    const tracker = createInMemoryTracker();
    tracker.recordStarting({providerRunnerId: 'a', templateKey: 'small'});

    tracker.markRunning('a');

    expect(tracker.countsByTemplate()).toEqual(new Map([['small', {starting: 0, running: 1}]]));
  });

  it('drops a removed runner from the counts', () => {
    const tracker = createInMemoryTracker();
    tracker.recordStarting({providerRunnerId: 'a', templateKey: 'small'});

    tracker.remove('a');

    expect(tracker.countsByTemplate()).toEqual(new Map());
  });

  it('ignores markRunning for an unknown runner', () => {
    const tracker = createInMemoryTracker();

    tracker.markRunning('missing');

    expect(tracker.countsByTemplate()).toEqual(new Map());
  });
});
