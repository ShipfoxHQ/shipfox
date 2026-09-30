export function formatReport(rows) {
  return rows.map((row) => `${row.name}: ${row.total}`).join('\n');
}

export function report(_args, rows) {
  return formatReport(rows);
}
