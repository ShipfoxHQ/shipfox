import {buildRunUrl} from './run-url.js';

describe('buildRunUrl', () => {
  test('builds HTTP and HTTPS URLs without duplicating trailing slashes', () => {
    expect(buildRunUrl('https://client.example.test///', 'run-1')).toBe(
      'https://client.example.test/runs/run-1',
    );
    expect(buildRunUrl('http://client.example.test', 'run-1')).toBe(
      'http://client.example.test/runs/run-1',
    );
  });

  test('omits URLs for malformed base URLs', () => {
    expect(buildRunUrl('not a URL', 'run-1')).toBeUndefined();
  });

  test('omits URLs for unsupported schemes', () => {
    expect(buildRunUrl('ftp://client.example.test', 'run-1')).toBeUndefined();
  });
});
