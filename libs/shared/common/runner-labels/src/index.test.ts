import {
  canonicalizeLabels,
  findInvalidLabels,
  MAX_RUNNER_LABEL_LENGTH,
  parseLabelList,
} from './index.js';

describe('canonicalizeLabels', () => {
  it('trims, lowercases, deduplicates, sorts, and drops empty labels', () => {
    const labels = canonicalizeLabels([' Ubuntu-Latest ', 'node-22', '', 'ubuntu-latest', ' GPU']);

    expect(labels).toEqual(['gpu', 'node-22', 'ubuntu-latest']);
  });

  it('treats a string as a single label', () => {
    const labels = canonicalizeLabels(' Ubuntu-Latest ');

    expect(labels).toEqual(['ubuntu-latest']);
  });

  it('treats undefined as an empty label set', () => {
    const labels = canonicalizeLabels(undefined);

    expect(labels).toEqual([]);
  });
});

describe('parseLabelList', () => {
  it('splits comma-delimited values before canonicalizing', () => {
    const labels = parseLabelList('ubuntu-latest, Node-22,ubuntu-latest,,gpu ');

    expect(labels).toEqual(['gpu', 'node-22', 'ubuntu-latest']);
  });

  it('parses an empty string as an empty label set', () => {
    const labels = parseLabelList('');

    expect(labels).toEqual([]);
  });
});

describe('findInvalidLabels', () => {
  it('accepts labels in the supported grammar', () => {
    const invalid = findInvalidLabels(['ubuntu-22.04', 'ubuntu_x64', 'node22']);

    expect(invalid).toEqual([]);
  });

  it('accepts labels at the maximum length', () => {
    const invalid = findInvalidLabels(['a'.repeat(MAX_RUNNER_LABEL_LENGTH)]);

    expect(invalid).toEqual([]);
  });

  it('returns labels with unsupported characters or length', () => {
    const overLength = 'a'.repeat(MAX_RUNNER_LABEL_LENGTH + 1);

    const invalid = findInvalidLabels(['ci,gpu', 'has space', 'has\nnewline', overLength]);

    expect(invalid).toEqual(['ci,gpu', 'has space', 'has\nnewline', overLength]);
  });
});
