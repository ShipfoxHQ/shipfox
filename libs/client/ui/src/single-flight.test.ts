import {createSingleFlight} from './single-flight.js';

describe('createSingleFlight', () => {
  it('shares concurrent callers and evicts the active request after success', async () => {
    const flight = createSingleFlight<string, string>();
    let resolve!: (value: string) => void;
    const operation = vi.fn(() => new Promise<string>((done) => (resolve = done)));

    const first = flight.run('callback', operation);
    const second = flight.run('callback', operation);
    await Promise.resolve();
    resolve('complete');

    await expect(Promise.all([first, second])).resolves.toEqual(['complete', 'complete']);
    await Promise.resolve();
    expect(operation).toHaveBeenCalledOnce();
    expect(flight.inFlightSize).toBe(0);
  });

  it('evicts rejected work so a later caller retries', async () => {
    const flight = createSingleFlight<string, string>();
    const operation = vi.fn().mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce('ok');

    await expect(flight.run('callback', operation)).rejects.toThrow('nope');
    await Promise.resolve();
    await expect(flight.run('callback', operation)).resolves.toBe('ok');

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('keeps only the requested number of terminal outcomes', async () => {
    const flight = createSingleFlight<string, string>({maxTerminalResults: 2});

    await flight.run('one', async () => 'one');
    await flight.run('two', async () => 'two');
    await flight.run('three', async () => 'three');
    await Promise.resolve();

    expect(flight.terminalSize).toBe(2);
  });
});
