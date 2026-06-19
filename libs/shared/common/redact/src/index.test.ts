import {
  REDACTION_PLACEHOLDER,
  redactSecrets,
  redactUrlCredentials,
  stripUrlCredentials,
} from './index.js';

describe('redactUrlCredentials', () => {
  it.each([
    ['https://user:pass@github.com/o/r.git', 'https://***@github.com/o/r.git'],
    ['http://user:pass@host/p', 'http://***@host/p'],
    ['git://user:pass@host/p', 'git://***@host/p'],
    ['ssh://git:key@host/p', 'ssh://***@host/p'],
  ])('redacts userinfo for scheme URL %s', (input, expected) => {
    const result = redactUrlCredentials(input);

    expect(result).toBe(expected);
  });

  it('redacts a bare user@ with no password', () => {
    const result = redactUrlCredentials('https://user@github.com/o/r.git');

    expect(result).toBe('https://***@github.com/o/r.git');
  });

  it('redacts credentials on a URL with a port', () => {
    const result = redactUrlCredentials('https://user:pass@host:8080/p');

    expect(result).toBe('https://***@host:8080/p');
  });

  it('redacts credentials on a URL with an IPv6 host', () => {
    const result = redactUrlCredentials('https://user:pass@[::1]:443/p');

    expect(result).toBe('https://***@[::1]:443/p');
  });

  it('redacts every occurrence in a line with mixed schemes', () => {
    const input = 'a https://u:p@h1/x and b git://u2:p2@h2/y end';

    const result = redactUrlCredentials(input);

    expect(result).toBe('a https://***@h1/x and b git://***@h2/y end');
  });

  it.each([
    'git@github.com:org/repo.git',
    'myapp:1.2.3@sha256:abcdef',
    'a:b@host:1',
    'https://github.com/o/r.git',
    'notify user@example.com about the build',
    'no credentials here at all',
    '',
  ])('leaves %s unchanged', (input) => {
    const result = redactUrlCredentials(input);

    expect(result).toBe(input);
  });

  it('stays linear on long adversarial input (ReDoS guard)', () => {
    const noColon = 'a'.repeat(200_000);
    const schemeNoAt = `https://${'a'.repeat(200_000)}`;
    const time = (fn: () => void): number => {
      const start = performance.now();
      fn();
      return performance.now() - start;
    };

    // Machine-relative budget: a plain linear scan over the same input scales
    // with the runner's speed, so this avoids the flakiness of an absolute
    // millisecond cap. A catastrophic-backtracking regex would run orders of
    // magnitude slower than this baseline (the bounded scheme prevents it).
    const linearScan = time(() => noColon.replace(/a/g, 'a'));
    const baseline = Math.max(linearScan, 1);
    const elapsed = time(() => {
      expect(redactUrlCredentials(noColon)).toBe(noColon);
      expect(redactUrlCredentials(schemeNoAt)).toBe(schemeNoAt);
    });

    expect(elapsed).toBeLessThan(baseline * 100);
  });
});

describe('stripUrlCredentials', () => {
  it('strips userinfo and leaves no *** residue', () => {
    const result = stripUrlCredentials('https://x-access-token:ghs_secret@github.com/o/r.git');

    expect(result).toBe('https://github.com/o/r.git');
    expect(result).not.toContain('ghs_secret');
    expect(result).not.toContain('***');
  });

  it('strips credentials on a URL with a port', () => {
    const result = stripUrlCredentials('https://user:pass@host:8080/p');

    expect(result).toBe('https://host:8080/p');
  });

  it('scrubs credentials when the authority is malformed and the URL does not parse', () => {
    const result = stripUrlCredentials('https://x-access-token:ghs_secret@github.com:bad/o/r.git');

    expect(result).toBe('https://***@github.com:bad/o/r.git');
    expect(result).not.toContain('ghs_secret');
  });

  it.each([
    'https://github.com/o/r.git',
    'git@github.com:org/repo.git',
    'not a url',
    '',
  ])('returns %s unchanged', (input) => {
    const result = stripUrlCredentials(input);

    expect(result).toBe(input);
  });
});

describe('redactSecrets', () => {
  it('removes every occurrence of each literal secret', () => {
    const result = redactSecrets('token=abc and again abc', ['abc']);

    expect(result).toBe('token=*** and again ***');
  });

  it.each([
    [['abcdef', 'abc']],
    [['abc', 'abcdef']],
  ])('fully redacts overlapping secrets regardless of order: %j', (secrets) => {
    const result = redactSecrets('token=abcdef', secrets);

    expect(result).toBe('token=***');
  });

  it('redacts a base64 basic-auth credential', () => {
    const base64 = Buffer.from('x-access-token:ghs_secret').toString('base64');

    const result = redactSecrets(`Authorization: Basic ${base64}`, [base64]);

    expect(result).toBe('Authorization: Basic ***');
  });

  it('composes URL credential scrubbing after literal removal', () => {
    const result = redactSecrets('clone https://user:pass@github.com/x.git failed', []);

    expect(result).toBe('clone https://***@github.com/x.git failed');
  });

  it('ignores empty strings in the secrets array', () => {
    const result = redactSecrets('keep this text', ['']);

    expect(result).toBe('keep this text');
  });

  it('returns empty text unchanged', () => {
    const result = redactSecrets('', ['secret']);

    expect(result).toBe('');
  });

  it('exposes the placeholder it writes', () => {
    expect(REDACTION_PLACEHOLDER).toBe('***');
  });
});
