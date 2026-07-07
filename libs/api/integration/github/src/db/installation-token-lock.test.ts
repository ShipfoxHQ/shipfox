import {withInstallationTokenLock} from './installation-token-lock.js';

describe('withInstallationTokenLock', () => {
  it('allows one holder per installation and fails contenders fast', async () => {
    let releaseLock: () => void = () => {
      throw new Error('releaseLock was not initialized');
    };
    const first = withInstallationTokenLock(
      9001,
      () =>
        new Promise<string>((resolve) => {
          releaseLock = () => resolve('winner');
        }),
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    const contender = await withInstallationTokenLock(9001, async () => 'contender');
    const different = await withInstallationTokenLock(9002, async () => 'different');
    releaseLock();
    const winner = await first;

    expect(contender).toEqual({acquired: false});
    expect(different).toEqual({acquired: true, value: 'different'});
    expect(winner).toEqual({acquired: true, value: 'winner'});
  });

  it('does not collide installations that differ outside the 32-bit range', async () => {
    let releaseLock: () => void = () => {
      throw new Error('releaseLock was not initialized');
    };
    const holder = withInstallationTokenLock(
      1,
      () =>
        new Promise<string>((resolve) => {
          releaseLock = () => resolve('holder');
        }),
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    const different = await withInstallationTokenLock(1 + 2 ** 32, async () => 'different');
    releaseLock();
    const held = await holder;

    expect(different).toEqual({acquired: true, value: 'different'});
    expect(held).toEqual({acquired: true, value: 'holder'});
  });

  it('does not exhaust a small pool when many contenders miss the try-lock', async () => {
    let releaseLock: () => void = () => {
      throw new Error('releaseLock was not initialized');
    };
    const holder = withInstallationTokenLock(
      9010,
      () =>
        new Promise<string>((resolve) => {
          releaseLock = () => resolve('holder');
        }),
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    const contenders = await Promise.all(
      Array.from({length: 20}, () => withInstallationTokenLock(9010, async () => 'contender')),
    );
    releaseLock();
    const held = await holder;

    expect(contenders).toEqual(Array.from({length: 20}, () => ({acquired: false})));
    expect(held).toEqual({acquired: true, value: 'holder'});
  });
});
