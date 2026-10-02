/** Writes rows as CSV text, one line per row. */
export function exportRows(rows) {
  return rows.map((row) => Object.values(row).join(',')).join('\n');
}
