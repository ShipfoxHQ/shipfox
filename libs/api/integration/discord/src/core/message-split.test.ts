import {
  DISCORD_MAX_MESSAGE_PARTS,
  DISCORD_MESSAGE_LIMIT,
  splitDiscordMessage,
} from './message-split.js';

describe('splitDiscordMessage', () => {
  it('keeps a message within the limit whole', () => {
    const text = 'a'.repeat(DISCORD_MESSAGE_LIMIT);

    expect(splitDiscordMessage(text)).toEqual([text]);
  });

  it('cuts on the last paragraph break that fits', () => {
    const first = 'a'.repeat(1_500);
    const second = 'b'.repeat(1_500);

    expect(splitDiscordMessage(`${first}\n\n${second}`)).toEqual([first, second]);
  });

  it('prefers a paragraph break over a later line break', () => {
    const first = 'a'.repeat(1_000);
    const second = `${'b'.repeat(500)}\n${'c'.repeat(600)}`;

    expect(splitDiscordMessage(`${first}\n\n${second}`)).toEqual([first, second]);
  });

  it('cuts on a line break when there is no paragraph break', () => {
    const first = 'a'.repeat(1_500);
    const second = 'b'.repeat(1_500);

    expect(splitDiscordMessage(`${first}\n${second}`)).toEqual([first, second]);
  });

  it('cuts on a space when there is no line break', () => {
    const first = 'a'.repeat(1_500);
    const second = 'b'.repeat(1_500);

    expect(splitDiscordMessage(`${first} ${second}`)).toEqual([first, second]);
  });

  it('cuts at the limit when there is no boundary', () => {
    const parts = splitDiscordMessage('a'.repeat(DISCORD_MESSAGE_LIMIT + 5));

    expect(parts).toEqual(['a'.repeat(DISCORD_MESSAGE_LIMIT), 'a'.repeat(5)]);
  });

  it('does not split a surrogate pair', () => {
    const parts = splitDiscordMessage(`${'a'.repeat(DISCORD_MESSAGE_LIMIT - 1)}😀 tail`);

    expect(parts?.[0]).toBe('a'.repeat(DISCORD_MESSAGE_LIMIT - 1));
    expect(parts?.[1]).toBe('😀 tail');
  });

  it('keeps every part within the limit', () => {
    const text = Array.from({length: 40}, (_, index) => `word${index}`.repeat(30)).join(' ');

    const parts = splitDiscordMessage(text);

    expect(parts?.length).toBeGreaterThan(1);
    for (const part of parts ?? []) expect(part.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
  });

  it('accepts text that fills exactly the maximum number of parts', () => {
    const paragraph = 'a'.repeat(DISCORD_MESSAGE_LIMIT);
    const text = Array.from({length: DISCORD_MAX_MESSAGE_PARTS}, () => paragraph).join('\n\n');

    expect(splitDiscordMessage(text)).toHaveLength(DISCORD_MAX_MESSAGE_PARTS);
  });

  it('refuses text that needs more parts than the maximum', () => {
    const paragraph = 'a'.repeat(DISCORD_MESSAGE_LIMIT);
    const text = Array.from({length: DISCORD_MAX_MESSAGE_PARTS + 1}, () => paragraph).join('\n\n');

    expect(splitDiscordMessage(text)).toBeUndefined();
  });

  it('refuses text over 10,000 characters', () => {
    expect(splitDiscordMessage('a'.repeat(10_001))).toBeUndefined();
  });
});
