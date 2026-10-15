import {parseAnchoredPattern as parseInDocument} from '@shipfox/workflow-document/anchored-path';
import {parseAnchoredPattern} from '#cache/anchored-path.js';

// Sync validates paths with the copy in @shipfox/workflow-document, and the runner with this one.
const LINES = [
  'node_modules',
  '~/.npm',
  '~//.npm',
  '/opt/tools',
  '//opt//tools/',
  './dist/',
  '  ~/x  ',
  'a/../b',
  '.',
  './',
  '~foo',
  '**/package-lock.json',
  '.../a',
  '',
  '   ',
  'a\nb',
  'a\0b',
  '~',
  '~/',
  '/',
  '/tmp/..',
  '~/cache/..',
  '../outside',
  'a/../../outside',
  '..',
  '~/../other',
  '/a/../../etc',
];

describe('parseAnchoredPattern', () => {
  it.each(LINES)('reads %j like @shipfox/workflow-document', (line) => {
    expect(parseAnchoredPattern(line)).toEqual(parseInDocument(line));
  });
});
