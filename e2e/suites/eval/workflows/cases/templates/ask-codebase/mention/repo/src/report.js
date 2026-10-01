export function formatReport(rows) {
  return rows.map((row) => `${row.name}: ${row.total}`).join('\n');
}

export function report(args, rows) {
  if (args.includes('--json')) return JSON.stringify(rows);
  return formatReport(rows);
}
