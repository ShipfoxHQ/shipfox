import {maskSessionTranscript} from '#core/session-transcript.js';

const LINE_BREAK = /\r\n|\n|\r/;

function parseRecords(jsonl: string): unknown[] {
  return jsonl
    .split(LINE_BREAK)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

describe('maskSessionTranscript', () => {
  it('masks escaped secrets after decoding JSON records', () => {
    const quoteSecret = 'quote"secret';
    const slashSecret = 'slash\\secret';
    const newlineSecret = 'line\nsecret';
    const unicodeSecret = 'unicode ☃';
    const input = [
      JSON.stringify({quote: quoteSecret, slash: slashSecret, nested: [newlineSecret]}),
      '{"unicode":"unicode \\u2603"}',
    ].join('\n');

    const masked = maskSessionTranscript({
      jsonl: input,
      secrets: [quoteSecret, slashSecret, newlineSecret, unicodeSecret],
    });
    const records = parseRecords(masked);

    expect(records).toEqual([{quote: '***', slash: '***', nested: ['***']}, {unicode: '***'}]);
    for (const secret of [quoteSecret, slashSecret, newlineSecret, unicodeSecret]) {
      expect(JSON.stringify(records)).not.toContain(secret);
    }
  });

  it('masks secrets used as object keys at every nesting level', () => {
    const secret = 'object-key-secret';
    const input = JSON.stringify({[secret]: {[`nested-${secret}`]: secret}});

    const masked = maskSessionTranscript({jsonl: input, secrets: [secret]});

    expect(JSON.parse(masked)).toEqual({'***': {'nested-***': '***'}});
  });

  it('raw-masks an unparseable line without dropping it', () => {
    const secret = 'raw-secret-value';
    const input = `{"safe":"value"}\nnot valid JSON: ${secret}\n{"last":true}`;

    const masked = maskSessionTranscript({jsonl: input, secrets: [secret]});

    expect(masked).toBe('{"safe":"value"}\nnot valid JSON: ***\n{"last":true}');
    expect(masked.split(LINE_BREAK)).toHaveLength(input.split(LINE_BREAK).length);
  });

  it('preserves empty lines and the input trailing newline behavior', () => {
    const secret = 'line-secret-value';
    const withTrailingNewline = `{"value":"${secret}"}\n\nraw ${secret}\n`;
    const withoutTrailingNewline = `{"value":"${secret}"}\n\nraw ${secret}`;

    const maskedWithTrailingNewline = maskSessionTranscript({
      jsonl: withTrailingNewline,
      secrets: [secret],
    });
    const maskedWithoutTrailingNewline = maskSessionTranscript({
      jsonl: withoutTrailingNewline,
      secrets: [secret],
    });

    expect(maskedWithTrailingNewline).toBe('{"value":"***"}\n\nraw ***\n');
    expect(maskedWithoutTrailingNewline).toBe('{"value":"***"}\n\nraw ***');
    expect(maskedWithTrailingNewline.split(LINE_BREAK)).toHaveLength(
      withTrailingNewline.split(LINE_BREAK).length,
    );
    expect(maskedWithoutTrailingNewline.split(LINE_BREAK)).toHaveLength(
      withoutTrailingNewline.split(LINE_BREAK).length,
    );
  });
});
