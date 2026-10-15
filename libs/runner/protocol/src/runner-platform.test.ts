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

  it('omits an operating system outside the reported set', () => {
    const result = runnerPlatform({platform: 'freebsd', arch: 'x64'});

    expect(result).toBeUndefined();
  });

  it('omits an architecture the API would reject', () => {
    const result = runnerPlatform({platform: 'linux', arch: 'Not-An-Arch'});

    expect(result).toBeUndefined();
  });

  it('defaults to the current process', () => {
    const result = runnerPlatform();

    expect(result?.arch).toBe(process.arch);
  });
});
