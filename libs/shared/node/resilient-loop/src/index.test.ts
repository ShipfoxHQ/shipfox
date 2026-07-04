import {
  createGracefulShutdownController,
  interruptibleSleep,
  nextBackoffInterval,
  withJitter,
} from './index.js';

describe('nextBackoffInterval', () => {
  it('grows by the default factor before the cap', () => {
    const next = nextBackoffInterval(1000, {maxMs: 5000});

    expect(next).toBe(1500);
  });

  it('caps at the configured maximum', () => {
    const next = nextBackoffInterval(4000, {maxMs: 5000});

    expect(next).toBe(5000);
  });

  it('uses a custom factor', () => {
    const next = nextBackoffInterval(1000, {maxMs: 5000, factor: 2});

    expect(next).toBe(2000);
  });
});

describe('withJitter', () => {
  it.each([
    {random: 0, expected: 0},
    {random: 0.25, expected: 2},
    {random: 0.999, expected: 7.992},
  ])('applies full jitter at random=$random', ({random, expected}) => {
    const sleep = withJitter(8, {random: () => random});

    expect(sleep).toBe(expected);
  });

  it('applies bounded jitter', () => {
    const sleep = withJitter(8, {minFactor: 0.5, maxFactor: 1, random: () => 0.25});

    expect(sleep).toBe(5);
  });

  it('keeps zero sleeps at zero when jittered', () => {
    const sleep = withJitter(0, {random: () => 0.999});

    expect(sleep).toBe(0);
  });
});

describe('interruptibleSleep', () => {
  it('resolves when the signal aborts', async () => {
    const controller = new AbortController();
    const sleep = interruptibleSleep(10_000, controller.signal);

    controller.abort('test');

    await expect(sleep).resolves.toBeUndefined();
  });

  it('resolves immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort('test');

    await expect(interruptibleSleep(10_000, controller.signal)).resolves.toBeUndefined();
  });
});

describe('createGracefulShutdownController', () => {
  const signal = 'SIGHUP';
  const controllers: {stop: () => void}[] = [];

  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.stop();
  });

  it('registers signal handlers once and removes them on stop', () => {
    const initialListeners = process.listenerCount(signal);
    const controller = createGracefulShutdownController({signals: [signal]});
    controllers.push(controller);

    controller.start();
    controller.start();

    expect(process.listenerCount(signal)).toBe(initialListeners + 1);
    controller.stop();
    controllers.splice(controllers.indexOf(controller), 1);

    expect(process.listenerCount(signal)).toBe(initialListeners);
  });

  it('runs first and second signal callbacks separately', () => {
    const firstSignals: NodeJS.Signals[] = [];
    const secondSignals: NodeJS.Signals[] = [];
    const controller = createGracefulShutdownController({
      signals: [signal],
      onFirstSignal: (receivedSignal) => firstSignals.push(receivedSignal),
      onSecondSignal: (receivedSignal) => secondSignals.push(receivedSignal),
    });
    controllers.push(controller);
    controller.start();

    process.emit(signal, signal);
    process.emit(signal, signal);

    expect(firstSignals).toEqual([signal]);
    expect(secondSignals).toEqual([signal]);
    expect(controller.isShuttingDown()).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it('deduplicates configured signal handlers', () => {
    const firstSignals: NodeJS.Signals[] = [];
    const secondSignals: NodeJS.Signals[] = [];
    const initialListeners = process.listenerCount(signal);
    const controller = createGracefulShutdownController({
      signals: [signal, signal],
      onFirstSignal: (receivedSignal) => firstSignals.push(receivedSignal),
      onSecondSignal: (receivedSignal) => secondSignals.push(receivedSignal),
    });
    controllers.push(controller);
    controller.start();

    process.emit(signal, signal);

    expect(process.listenerCount(signal)).toBe(initialListeners + 1);
    expect(firstSignals).toEqual([signal]);
    expect(secondSignals).toEqual([]);

    process.emit(signal, signal);

    expect(firstSignals).toEqual([signal]);
    expect(secondSignals).toEqual([signal]);
  });

  it('resets shutdown state and creates a fresh abort signal', () => {
    const controller = createGracefulShutdownController({signals: [signal]});
    controllers.push(controller);
    controller.start();

    process.emit(signal, signal);
    const abortedSignal = controller.signal;
    controller.reset();

    expect(controller.isShuttingDown()).toBe(false);
    expect(controller.signal).not.toBe(abortedSignal);
    expect(controller.signal.aborted).toBe(false);
  });
});
