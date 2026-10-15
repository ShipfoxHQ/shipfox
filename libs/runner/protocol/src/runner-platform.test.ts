import {runnerPlatform} from '#runner-platform.js';

describe('runnerPlatform', () => {
  it.each([
    {platform: 'linux', arch: 'x64', expected: {os: 'linux', arch: 'x64'}},
    {platform: 'darwin', arch: 'arm64', expected: {os: 'darwin', arch: 'arm64'}},
    {platform: 'win32', arch: 'x64', expected: {os: 'windows', arch: 'x64'}},
  ] as const)('reports $platform/$arch', ({platform, arch, expected}) => {
    const result = runnerPlatform({platform, arch});

    expect(result).toEqual(expected);
  });

  it.each([
    {platform: 'freebsd', arch: 'x64'},
    {platform: 'linux', arch: 'Not-An-Arch'},
  ] as const)('throws on $platform/$arch, which the API rejects', ({platform, arch}) => {
    expect(() => runnerPlatform({platform, arch})).toThrow(
      `Shipfox runners do not support ${platform} on ${arch}.`,
    );
  });

  it('defaults to the current process', () => {
    const result = runnerPlatform();

    expect(result.arch).toBe(process.arch);
  });
});
