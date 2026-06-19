import {couldBeMarker, type MarkerEvent, parseMarker} from '#core/markers.js';

describe('parseMarker', () => {
  it('parses a group_start with its name', () => {
    expect(parseMarker('::group::Install deps')).toEqual({
      kind: 'group_start',
      name: 'Install deps',
    });
  });

  it('parses a group_end', () => {
    expect(parseMarker('::endgroup::')).toEqual({kind: 'group_end'});
  });

  it('strips a trailing CR so CRLF lines match', () => {
    expect(parseMarker('::group::Build\r')).toEqual({kind: 'group_start', name: 'Build'});
    expect(parseMarker('::endgroup::\r')).toEqual({kind: 'group_end'});
  });

  it('strips a trailing LF (or CRLF) when the line still carries it', () => {
    expect(parseMarker('::group::Build\n')).toEqual({kind: 'group_start', name: 'Build'});
    expect(parseMarker('::endgroup::\r\n')).toEqual({kind: 'group_end'});
  });

  it('treats an empty group name as a group_start with an empty name', () => {
    expect(parseMarker('::group::')).toEqual({kind: 'group_start', name: ''});
  });

  it.each([
    ['endgroup with a trailing argument', '::endgroup:: extra'],
    ['leading whitespace before the marker', '  ::group::Build'],
    ['marker not at line start', 'see ::group::Build'],
    ['a near-miss prefix', '::groupx Build'],
    ['plain output', 'installing dependencies...'],
    ['an empty line', ''],
  ])('returns undefined for %s', (_label, line) => {
    expect(parseMarker(line)).toBeUndefined();
  });

  it('keeps the group name verbatim (downstream masks and truncates it)', () => {
    const result = parseMarker('::group::token=sf_rt_abc and spaces  ');

    expect(result).toEqual<MarkerEvent>({
      kind: 'group_start',
      name: 'token=sf_rt_abc and spaces  ',
    });
  });
});

describe('couldBeMarker', () => {
  it.each([
    ['empty', ''],
    ['a partial marker sigil', '::'],
    ['a partial group prefix', '::gro'],
    ['a partial endgroup', '::endgr'],
    ['a complete group_start with a name', '::group::Install deps'],
    ['a complete endgroup awaiting its newline', '::endgroup::'],
  ])('holds %s', (_label, prefix) => {
    expect(couldBeMarker(prefix)).toBe(true);
  });

  it.each([
    ['a CRLF endgroup awaiting its LF', '::endgroup::\r'],
    ['a CRLF group_start awaiting its LF', '::group::Build\r'],
  ])('holds %s so the marker is not released before its newline', (_label, prefix) => {
    expect(couldBeMarker(prefix)).toBe(true);
  });

  it.each([
    ['plain output', 'installing'],
    ['a diverged sigil', '::x'],
    ['endgroup with a trailing argument', '::endgroup:: extra'],
  ])('releases %s', (_label, prefix) => {
    expect(couldBeMarker(prefix)).toBe(false);
  });
});
