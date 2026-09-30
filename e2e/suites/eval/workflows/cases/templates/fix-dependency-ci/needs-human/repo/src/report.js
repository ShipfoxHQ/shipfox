import {pad} from '../vendor/pad/index.js';

export function formatReport(rows) {
  const width = Math.max(...rows.map((row) => row.name.length));
  return rows.map((row) => `${pad(row.name, width)} ${row.total}`).join('\n');
}
