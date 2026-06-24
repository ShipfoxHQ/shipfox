import {
  assertValidComboboxOptions,
  type ComboboxOption,
  clearMultiComboboxValues,
  filterComboboxOptions,
  getNextActiveComboboxValue,
  partitionComboboxChipsByCount,
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
  it('rejects empty option values', () => {
    const invalidOptions: ComboboxOption[] = [{value: '', label: 'Empty'}];

    expect(() => assertValidComboboxOptions(invalidOptions)).toThrow(
      'ComboboxOption values must be non-empty.',
    );
  });

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

  it('returns all options for an empty search', () => {
    const result = filterComboboxOptions(options, '   ');

    expect(result).toEqual(options);
  });

  it('matches the search against both label and value, case-insensitively', () => {
    const items: ComboboxOption[] = [
      {value: 'apache', label: 'Apache HTTP'},
      {value: 'apollo', label: 'Apollo'},
    ];

    const byLabel = filterComboboxOptions(items, 'HTTP');
    const byValue = filterComboboxOptions(items, 'APOL');

    expect(byLabel).toEqual([{value: 'apache', label: 'Apache HTTP'}]);
    expect(byValue).toEqual([{value: 'apollo', label: 'Apollo'}]);
  });

  it('moves the active value and clamps at both ends', () => {
    const values = ['apache', 'apollo', 'apify'];

    expect(getNextActiveComboboxValue(values, null, 1)).toBe('apache');
    expect(getNextActiveComboboxValue(values, null, -1)).toBe('apify');
    expect(getNextActiveComboboxValue(values, 'apache', 1)).toBe('apollo');
    expect(getNextActiveComboboxValue(values, 'apache', -1)).toBe('apache');
    expect(getNextActiveComboboxValue(values, 'apify', 1)).toBe('apify');
  });

  it('resets an unknown active value to the first entry and yields null for an empty list', () => {
    expect(getNextActiveComboboxValue(['apache', 'apollo'], 'gone', 1)).toBe('apache');
    expect(getNextActiveComboboxValue([], null, 1)).toBeNull();
  });
});
