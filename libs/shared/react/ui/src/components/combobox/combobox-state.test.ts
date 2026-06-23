import {
  type ComboboxOption,
  clearMultiComboboxValues,
  partitionComboboxChipsByCount,
  partitionComboboxChipsByWidth,
  removeMultiComboboxValue,
  resolveComboboxLabel,
  toggleMultiComboboxValue,
  toggleSingleComboboxValue,
} from './combobox-state.js';

const options: ComboboxOption[] = [
  {value: 'apache', label: 'Apache'},
  {value: 'apollo', label: 'Apollo'},
  {value: 'apify', label: 'Apify'},
];

describe('combobox state helpers', () => {
  it('sets an unselected single value', () => {
    const result = toggleSingleComboboxValue('', 'apache');

    expect(result).toBe('apache');
  });

  it('clears a selected single value', () => {
    const result = toggleSingleComboboxValue('apache', 'apache');

    expect(result).toBe('');
  });

  it('adds an unselected multi value', () => {
    const result = toggleMultiComboboxValue(['apache'], 'apollo');

    expect(result).toEqual(['apache', 'apollo']);
  });

  it('removes a selected multi value', () => {
    const result = toggleMultiComboboxValue(['apache', 'apollo'], 'apache');

    expect(result).toEqual(['apollo']);
  });

  it('removes one multi value without touching the others', () => {
    const result = removeMultiComboboxValue(['apache', 'apollo', 'apify'], 'apollo');

    expect(result).toEqual(['apache', 'apify']);
  });

  it('clears every multi value', () => {
    const result = clearMultiComboboxValues();

    expect(result).toEqual([]);
  });

  it('resolves known labels and falls back to raw unknown values', () => {
    const known = resolveComboboxLabel(options, 'apache');
    const unknown = resolveComboboxLabel(options, 'unknown-repo');

    expect(known).toBe('Apache');
    expect(unknown).toBe('unknown-repo');
  });

  it('partitions chips by count', () => {
    const result = partitionComboboxChipsByCount(['apache', 'apollo', 'apify'], 2);

    expect(result).toEqual({visibleValues: ['apache', 'apollo'], hiddenCount: 1});
  });

  it('normalizes negative count partitioning to summary-only', () => {
    const result = partitionComboboxChipsByCount(['apache', 'apollo'], -1);

    expect(result).toEqual({visibleValues: [], hiddenCount: 2});
  });

  it('partitions chips by measured width and reserves room for overflow', () => {
    const result = partitionComboboxChipsByWidth({
      values: ['apache', 'apollo', 'apify'],
      valueWidths: new Map([
        ['apache', 50],
        ['apollo', 50],
        ['apify', 50],
      ]),
      availableWidth: 130,
      overflowChipWidth: 24,
      gapWidth: 4,
    });

    expect(result).toEqual({visibleValues: ['apache'], hiddenCount: 2});
  });

  it('shows every measured chip when they all fit', () => {
    const result = partitionComboboxChipsByWidth({
      values: ['apache', 'apollo'],
      valueWidths: new Map([
        ['apache', 50],
        ['apollo', 50],
      ]),
      availableWidth: 104,
      overflowChipWidth: 24,
      gapWidth: 4,
    });

    expect(result).toEqual({visibleValues: ['apache', 'apollo'], hiddenCount: 0});
  });

  it('falls back to a deterministic count when a chip width is unavailable', () => {
    const result = partitionComboboxChipsByWidth({
      values: ['apache', 'apollo', 'apify'],
      valueWidths: new Map([['apache', 50]]),
      availableWidth: 200,
      overflowChipWidth: 24,
      gapWidth: 4,
    });

    expect(result).toEqual({visibleValues: ['apache', 'apollo'], hiddenCount: 1});
  });

  it('returns an empty partition when there are no values', () => {
    const result = partitionComboboxChipsByWidth({
      values: [],
      valueWidths: new Map(),
      availableWidth: 200,
      overflowChipWidth: 24,
      gapWidth: 4,
    });

    expect(result).toEqual({visibleValues: [], hiddenCount: 0});
  });

  it('hides every chip when no width is available', () => {
    const result = partitionComboboxChipsByWidth({
      values: ['apache', 'apollo'],
      valueWidths: new Map([
        ['apache', 50],
        ['apollo', 50],
      ]),
      availableWidth: 0,
      overflowChipWidth: 24,
      gapWidth: 4,
    });

    expect(result).toEqual({visibleValues: [], hiddenCount: 2});
  });
});
