import {formatEnvEntry, formatMaskEntries, formatPathEntry} from '#step-files.js';

const ENV_HEREDOC_RE = /^CERT<<(SHIPFOX_ENV_[0-9a-f-]{36})\nline one\nline two\n\1\n$/;

describe('formatEnvEntry', () => {
  it('writes a single-line value as NAME=value', () => {
    const entry = formatEnvEntry('TOOL_HOME', '/opt/tool');

    expect(entry).toBe('TOOL_HOME=/opt/tool\n');
  });

  it('writes a multi-line value as a heredoc block', () => {
    const entry = formatEnvEntry('CERT', 'line one\nline two');

    expect(entry).toMatch(ENV_HEREDOC_RE);
  });

  it.each([
    ['PATH', 'setEnv cannot set "PATH". Use addPath instead.'],
    [
      'SHIPFOX_TOKEN',
      'setEnv cannot set "SHIPFOX_TOKEN". Names starting with SHIPFOX_ are reserved.',
    ],
    ['NOT-A-NAME', 'setEnv got an invalid variable name: "NOT-A-NAME".'],
  ])('rejects the name %s', (name, message) => {
    const format = () => formatEnvEntry(name, 'value');

    expect(format).toThrow(message);
  });

  it('rejects a value that is not a string', () => {
    const format = () => formatEnvEntry('COUNT', 3 as unknown as string);

    expect(format).toThrow('setEnv needs a string value for "COUNT", but got number.');
  });
});

describe('formatPathEntry', () => {
  it('writes one directory on a line', () => {
    const entry = formatPathEntry('/opt/tool/bin');

    expect(entry).toBe('/opt/tool/bin\n');
  });

  it.each(['', '  ', '/a\n/b'])('rejects %j', (directory) => {
    const format = () => formatPathEntry(directory);

    expect(format).toThrow('addPath needs one directory, without line breaks.');
  });
});

describe('formatMaskEntries', () => {
  it('writes a value on one line', () => {
    const entries = formatMaskEntries('runtime-token');

    expect(entries).toBe('runtime-token\n');
  });

  it('writes each line of a multi-line value that is long enough to mask', () => {
    const entries = formatMaskEntries(
      '-----BEGIN KEY-----\nabc\n\nMIIEvQIBADANBg\r\n-----END KEY-----',
    );

    expect(entries).toBe('-----BEGIN KEY-----\nMIIEvQIBADANBg\n-----END KEY-----\n');
  });

  it.each(['short', '', '        ', 'a\nb'])('rejects %j without quoting it', (value) => {
    const format = () => formatMaskEntries(value);

    expect(format).toThrow(
      'addMask needs a value of at least 8 characters. A shorter value would hide ordinary text in the logs.',
    );
  });
});
