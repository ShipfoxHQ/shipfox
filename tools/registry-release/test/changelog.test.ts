import {extractChangelogSection} from '../src/changelog.js';

const changelog = `# @shipfox/template-x

## 1.2.0

### Minor changes

- Adds an option.

## 1.1.1

### Patch changes

- Fixes a prompt.

## 1.0.0

- First release.
`;

describe('extractChangelogSection', () => {
  it('returns the body between the version heading and the next one', () => {
    expect(extractChangelogSection({changelog, version: '1.2.0'})).toBe(
      '### Minor changes\n\n- Adds an option.',
    );
  });

  it('returns the last section to the end of the file', () => {
    expect(extractChangelogSection({changelog, version: '1.0.0'})).toBe('- First release.');
  });

  it('does not match a version that only shares a prefix', () => {
    expect(extractChangelogSection({changelog, version: '1.1.0'})).toBeUndefined();
    expect(extractChangelogSection({changelog, version: '1.2'})).toBeUndefined();
  });

  it('returns undefined for an empty section', () => {
    expect(
      extractChangelogSection({changelog: '## 1.0.0\n\n## 0.9.0\n\n- Old.\n', version: '1.0.0'}),
    ).toBeUndefined();
  });
});
