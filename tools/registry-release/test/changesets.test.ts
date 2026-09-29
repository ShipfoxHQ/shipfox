import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseChangeset, pendingBumps, readPendingChangesets} from '../src/changesets.js';

describe('parseChangeset', () => {
  it('reads the bump of each package, with either quote style', () => {
    const changeset = parseChangeset({
      file: 'a.md',
      text: `---\n'@shipfox/template-x': minor\n"@shipfox/other": patch\n---\n\nAdds an option.\n`,
    });

    expect(changeset.releases).toEqual({'@shipfox/template-x': 'minor', '@shipfox/other': 'patch'});
  });

  it('reads an empty changeset as no releases', () => {
    expect(parseChangeset({file: 'empty.md', text: '---\n---\n'}).releases).toEqual({});
  });

  it('rejects a file without frontmatter', () => {
    expect(() => parseChangeset({file: 'bad.md', text: 'Just prose.\n'})).toThrow(
      'bad.md has no changeset frontmatter',
    );
  });

  it('rejects an unknown bump', () => {
    expect(() =>
      parseChangeset({file: 'bad.md', text: `---\n'@shipfox/x': huge\n---\n\nText.\n`}),
    ).toThrow('bad.md has an invalid release');
  });
});

describe('pendingBumps', () => {
  it('keeps the highest bump of each package across changesets', () => {
    const bumps = pendingBumps([
      {file: 'a.md', releases: {'@shipfox/x': 'patch', '@shipfox/y': 'major'}},
      {file: 'b.md', releases: {'@shipfox/x': 'minor'}},
      {file: 'c.md', releases: {'@shipfox/x': 'patch'}},
    ]);

    expect(Object.fromEntries(bumps)).toEqual({'@shipfox/x': 'minor', '@shipfox/y': 'major'});
  });
});

describe('readPendingChangesets', () => {
  it('reads every changeset file and skips the README', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'changesets-'));
    await writeFile(join(directory, 'README.md'), '# Changesets\n');
    await writeFile(join(directory, 'b.md'), `---\n'@shipfox/x': minor\n---\n\nB.\n`);
    await writeFile(join(directory, 'a.md'), `---\n'@shipfox/y': patch\n---\n\nA.\n`);

    const changesets = await readPendingChangesets(directory);

    expect(changesets.map(({file}) => file)).toEqual(['a.md', 'b.md']);
  });
});
