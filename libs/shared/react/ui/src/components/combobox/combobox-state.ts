/**
 * Option values must be unique within a combobox. Duplicate values are unsupported;
 * label lookup uses the first matching option.
 */
export type ComboboxOption = {
  value: string;
  label: string;
};

export type ComboboxChipPartition = {
  visibleValues: string[];
  hiddenCount: number;
};

export function toggleSingleComboboxValue(currentValue: string, selectedValue: string): string {
  return currentValue === selectedValue ? '' : selectedValue;
}

export function toggleMultiComboboxValue(currentValues: string[], selectedValue: string): string[] {
  if (currentValues.includes(selectedValue)) {
    return currentValues.filter((value) => value !== selectedValue);
  }

  return [...currentValues, selectedValue];
}

export function removeMultiComboboxValue(currentValues: string[], valueToRemove: string): string[] {
  return currentValues.filter((value) => value !== valueToRemove);
}

export function clearMultiComboboxValues(): string[] {
  return [];
}

export function resolveComboboxLabel(options: ComboboxOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * Case-insensitive substring filter over both label and value. An empty (or
 * whitespace-only) search returns every option in their original order.
 */
export function filterComboboxOptions(options: ComboboxOption[], search: string): ComboboxOption[] {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return options;
  }

  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(normalizedSearch) ||
      option.value.toLowerCase().includes(normalizedSearch),
  );
}

/**
 * Move the keyboard-active value one step through `values`, clamping at both ends
 * (no wrap-around). With no active value, `1` lands on the first entry and `-1` on
 * the last. An unknown active value resets to the first entry.
 */
export function getNextActiveComboboxValue(
  values: string[],
  activeValue: string | null,
  direction: 1 | -1,
): string | null {
  if (values.length === 0) {
    return null;
  }
  if (activeValue === null) {
    return (direction > 0 ? values[0] : values[values.length - 1]) ?? null;
  }

  const index = values.indexOf(activeValue);
  if (index === -1) {
    return values[0] ?? null;
  }

  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= values.length) {
    return activeValue;
  }
  return values[nextIndex] ?? null;
}

export function partitionComboboxChipsByCount(
  values: string[],
  maxVisibleChips: number,
): ComboboxChipPartition {
  const visibleCount = Math.max(0, Math.floor(maxVisibleChips));
  const visibleValues = values.slice(0, visibleCount);

  return {
    visibleValues,
    hiddenCount: values.length - visibleValues.length,
  };
}
