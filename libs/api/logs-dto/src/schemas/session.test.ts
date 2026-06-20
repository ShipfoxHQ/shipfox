import {Buffer} from 'node:buffer';
import {parseSessionLine} from './session.js';

const CAP = 1024;

describe('parseSessionLine', () => {
  it('accepts a well-formed JSON line within the cap', () => {
    expect(() => parseSessionLine('{"type":"session","version":3}', CAP)).not.toThrow();
  });

  it('rejects a non-JSON line', () => {
    expect(() => parseSessionLine('not json', CAP)).toThrow();
  });

  it('rejects a line over the byte cap', () => {
    const line = JSON.stringify({blob: 'x'.repeat(CAP)});

    expect(Buffer.byteLength(line, 'utf8')).toBeGreaterThan(CAP);
    expect(() => parseSessionLine(line, CAP)).toThrow();
  });

  it('accepts a line exactly at the byte cap', () => {
    const padding = 'x'.repeat(CAP - Buffer.byteLength('{"p":""}', 'utf8'));
    const line = `{"p":"${padding}"}`;

    expect(Buffer.byteLength(line, 'utf8')).toBe(CAP);
    expect(() => parseSessionLine(line, CAP)).not.toThrow();
  });

  it('is format-agnostic: accepts a Claude/Codex-shaped line, not just pi', () => {
    expect(() =>
      parseSessionLine('{"type":"assistant","message":{"role":"assistant","content":[]}}', CAP),
    ).not.toThrow();
  });

  it('treats a line that looks like a log control record as opaque JSON, not a tombstone', () => {
    // The session validator never interprets line shape; a literal {"type":"capped"}
    // is just valid JSON to be stored verbatim, not the server-only tombstone.
    expect(() => parseSessionLine('{"v":1,"ts":1,"type":"capped"}', CAP)).not.toThrow();
  });
});
