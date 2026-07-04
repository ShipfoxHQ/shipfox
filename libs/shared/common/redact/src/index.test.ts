import {
  REDACTION_PLACEHOLDER,
  redactSecrets,
  redactUrlCredentials,
  safeRedactionPrefixLength,
  secretWireForms,
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

describe('safeRedactionPrefixLength', () => {
  it('holds a prefix that could still become a secret', () => {
    const cut = safeRedactionPrefixLength('prefix runtime-sec', ['runtime-secret-value']);

    expect(cut).toBe(0);
  });

  it('emits safe text while retaining enough lookbehind for split secrets', () => {
    const secret = 'runtime-secret-value';
    const prefix = 'safe output before '.repeat(2);
    const buffer = `${prefix}${secret.slice(0, 8)}`;

    const cut = safeRedactionPrefixLength(buffer, [secret]);

    expect(cut).toBeGreaterThan(0);
    expect(buffer.slice(0, cut)).not.toContain(secret.slice(0, 8));
    expect(buffer.slice(cut)).toContain(secret.slice(0, 8));
  });

  it('backs up before a complete occurrence that straddles the initial cut', () => {
    const secret = 'runtime-secret-value';
    const buffer = `prefix ${secret} suffix`;

    const cut = safeRedactionPrefixLength(buffer, [secret]);

    expect(buffer.slice(0, cut)).toBe('prefix ');
  });

  it('emits the whole buffer when there are no secrets', () => {
    const buffer = 'ordinary output';

    const cut = safeRedactionPrefixLength(buffer, []);

    expect(cut).toBe(buffer.length);
  });
});

describe('secretWireForms', () => {
  it('derives the exact deduped, longest-first form set for a token', () => {
    const forms = secretWireForms('sk_live_TESTsecret123');

    expect(forms).toEqual([
      '736b5f6c6976655f54455354736563726574313233', // hex lower
      '736B5F6C6976655F54455354736563726574313233', // hex upper
      'c2tfbGl2ZV9URVNUc2VjcmV0MTIz', // base64 / base64url phase 0
      'NrX2xpdmVfVEVTVHNlY3JldDEyM', // phase 1 (alphabets coincide here)
      'za19saXZlX1RFU1RzZWNyZXQxMj', // phase 2
      'sk_live_TESTsecret123', // literal
    ]);
  });

  it.each([0, 1, 2])('masks a secret embedded at base64 phase alignment %i', (phase) => {
    const secret = 'sk_live_TESTsecret123';
    const forms = secretWireForms(secret);
    const blob = Buffer.concat([
      Buffer.alloc(phase, 0x41),
      Buffer.from(secret),
      Buffer.from('TAILTAIL'),
    ]).toString('base64');

    const masked = redactSecrets(blob, forms);

    expect(forms.some((form) => blob.includes(form))).toBe(true);
    expect(forms.some((form) => masked.includes(form))).toBe(false);
    expect(masked).toContain('***');
  });

  it('derives distinct base64 and base64url forms when the alphabets diverge', () => {
    const forms = secretWireForms('??>>secret<<??value');

    expect(forms).toContain('Pz8+PnNlY3JldDw8Pz92YWx1Z'); // base64 phase 0 (+)
    expect(forms).toContain('Pz8-PnNlY3JldDw8Pz92YWx1Z'); // base64url phase 0 (-)
  });

  it('masks the URL-encoded form when it differs from the literal', () => {
    const secret = '??>>secret<<??value';
    const forms = secretWireForms(secret);

    const masked = redactSecrets(`GET /x?t=${encodeURIComponent(secret)}`, forms);

    expect(masked).toBe('GET /x?t=***');
  });

  it('masks lower- and upper-case hex forms', () => {
    const secret = 'sk_live_TESTsecret123';
    const forms = secretWireForms(secret);
    const hex = Buffer.from(secret).toString('hex');

    expect(redactSecrets(`digest=${hex}`, forms)).toBe('digest=***');
    expect(redactSecrets(`digest=${hex.toUpperCase()}`, forms)).toBe('digest=***');
  });

  it('always keeps the literal but drops every too-short derived form', () => {
    // 'abc' is 3 chars: the literal always masks, but every derived form (hex 6, base64 3-4,
    // url-encoded 3) is under the 8-char floor and dropped, so no short derivation scrubs
    // unrelated text.
    const forms = secretWireForms('abc');

    expect(forms).toEqual(['abc']);
  });

  it('keeps a derived form that clears the floor while dropping the shorter ones', () => {
    // 'wxyz' is 4 chars: the literal always masks and its 8-char hex clears the floor, but its
    // base64 phase forms (5 chars or fewer) are dropped, since a short base64 substring
    // over-matches common encoded text.
    const forms = secretWireForms('wxyz');
    const base64Phase0 = Buffer.from('wxyz').toString('base64').slice(0, 5);

    expect(forms).toContain('wxyz');
    expect(forms).toContain(Buffer.from('wxyz').toString('hex'));
    expect(forms).not.toContain(base64Phase0);
  });

  it('returns forms sorted longest-first', () => {
    const lengths = secretWireForms('sk_live_TESTsecret123').map((form) => form.length);

    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
  });

  it('returns no forms for an empty secret', () => {
    expect(secretWireForms('')).toEqual([]);
  });
});
