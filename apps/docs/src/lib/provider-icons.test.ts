import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {providerGlyphs} from '@/lib/provider-icons';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const JAM_LOGO_SOURCE = 'libs/shared/react/ui/src/components/icon/custom/jam-logo.tsx';
const VIEW_BOX_PATTERN = /viewBox="([^"]+)"/u;
const PATH_DATA_PATTERN = /\bd="([^"]+)"/gu;
const EVEN_ODD_PATTERN = /fillRule="evenodd"/u;

test('keeps the Jam glyph identical to the client JamLogo', () => {
  const source = readFileSync(`${repositoryRoot}${JAM_LOGO_SOURCE}`, 'utf8');
  const paths = [...source.matchAll(PATH_DATA_PATTERN)].map((match) => match[1]);

  assert.equal(providerGlyphs.jam.viewBox, source.match(VIEW_BOX_PATTERN)?.[1]);
  assert.equal(providerGlyphs.jam.path, paths.join(''));
  assert.match(source, EVEN_ODD_PATTERN);
});
