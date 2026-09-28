import {type ActionLogWriters, createActionLog} from '#log.js';

describe('createActionLog', () => {
  function capture(): ActionLogWriters & {lines: string[]} {
    const lines: string[] = [];
    return {
      lines,
      stdout: (text) => lines.push(`stdout ${text}`),
      stderr: (text) => lines.push(`stderr ${text}`),
    };
  }

  it('writes info to stdout and warnings and errors to stderr', () => {
    const writers = capture();
    const log = createActionLog(writers);

    log.info('Collected 3 messages');
    log.warn('Author lookup failed');
    log.error('Page 2 failed');

    expect(writers.lines).toEqual([
      'stdout Collected 3 messages\n',
      'stderr warning: Author lookup failed\n',
      'stderr error: Page 2 failed\n',
    ]);
  });

  it('wraps a group in ::group:: markers and returns its result', async () => {
    const writers = capture();
    const log = createActionLog(writers);

    const result = await log.group('Fetch pages', () => {
      log.info('page 1');
      return Promise.resolve(7);
    });

    expect(result).toBe(7);
    expect(writers.lines).toEqual([
      'stdout ::group::Fetch pages\n',
      'stdout page 1\n',
      'stdout ::endgroup::\n',
    ]);
  });

  it('closes the group when the callback throws', async () => {
    const writers = capture();
    const log = createActionLog(writers);

    const group = log.group('Fetch pages', () => {
      throw new Error('boom');
    });

    await expect(group).rejects.toThrow('boom');
    expect(writers.lines).toEqual(['stdout ::group::Fetch pages\n', 'stdout ::endgroup::\n']);
  });

  it('keeps a multi-line group name on the marker line', async () => {
    const writers = capture();
    const log = createActionLog(writers);

    await log.group('first\nsecond', () => undefined);

    expect(writers.lines[0]).toBe('stdout ::group::first second\n');
  });
});
