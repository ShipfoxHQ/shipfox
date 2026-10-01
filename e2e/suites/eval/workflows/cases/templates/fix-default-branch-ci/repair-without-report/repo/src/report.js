export function formatReport(rows) {
  return rows.map((row) => `${row.name}: ${row.total}`).join(', ');
}
