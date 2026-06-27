export function canonicalizeRunnerLabels(labels: string[]): string[] {
  const canonical = new Set<string>();

  for (const label of labels) {
    const value = label.trim().toLowerCase();
    if (value.length > 0) canonical.add(value);
  }

  return [...canonical].sort();
}
