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

export function partitionComboboxChipsByWidth({
  values,
  valueWidths,
  availableWidth,
  overflowChipWidth,
  gapWidth,
}: {
  values: string[];
  valueWidths: Map<string, number>;
  availableWidth: number;
  overflowChipWidth: number;
  gapWidth: number;
}): ComboboxChipPartition {
  if (values.length === 0) {
    return {visibleValues: [], hiddenCount: 0};
  }

  if (availableWidth <= 0) {
    return {visibleValues: [], hiddenCount: values.length};
  }

  const visibleValues: string[] = [];
  let usedWidth = 0;

  for (const value of values) {
    const valueWidth = valueWidths.get(value);
    if (valueWidth === undefined) {
      return partitionComboboxChipsByCount(values, 2);
    }

    const nextVisibleCount = visibleValues.length + 1;
    const hiddenCountAfterNext = values.length - nextVisibleCount;
    const nextGapWidth = visibleValues.length > 0 ? gapWidth : 0;
    const reservedOverflowWidth = hiddenCountAfterNext > 0 ? overflowChipWidth + gapWidth : 0;
    const nextUsedWidth = usedWidth + nextGapWidth + valueWidth;

    if (nextUsedWidth + reservedOverflowWidth > availableWidth) {
      break;
    }

    visibleValues.push(value);
    usedWidth = nextUsedWidth;
  }

  return {
    visibleValues,
    hiddenCount: values.length - visibleValues.length,
  };
}
