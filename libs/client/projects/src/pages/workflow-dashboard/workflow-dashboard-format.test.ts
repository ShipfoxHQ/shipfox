import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {formatDuration, formatRelativeTime} from './lib/workflow-dashboard-format.js';
import {workflowStatusLabel, workflowStatusVariant} from './lib/workflow-dashboard-status.js';

const cssImportPattern = /import\s+['"].*\.css['"]/;

describe('workflow dashboard formatting', () => {
  test.each([
    [0, '0s'],
    [59, '59s'],
    [60, '1m00s'],
    [65, '1m05s'],
    [3599, '59m59s'],
    [3600, '1h00m'],
    [3660, '1h01m'],
    [null, '-'],
  ])('formats duration %s as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  test.each([
    ['2026-06-12T12:09:45Z', '15s ago'],
    ['2026-06-12T12:08:00Z', '2m ago'],
    ['2026-06-12T10:10:00Z', '2h ago'],
    ['2026-06-10T12:10:00Z', '2d ago'],
  ])('formats relative time %s as %s', (iso, expected) => {
    expect(formatRelativeTime(iso, '2026-06-12T12:10:00Z')).toBe(expected);
  });

  test.each([
    ['succeeded', 'success', 'Succeeded'],
    ['failed', 'error', 'Failed'],
    ['running', 'info', 'Running'],
    ['awaiting-runner', 'warning', 'Awaiting runner'],
    ['unknown', 'neutral', 'Unknown'],
  ])('maps status %s', (status, variant, label) => {
    expect(workflowStatusVariant(status)).toBe(variant);
    expect(workflowStatusLabel(status)).toBe(label);
  });

  test('dashboard source files do not import local CSS', () => {
    const dashboardDir = new URL('.', import.meta.url);
    const files = sourceFiles(dashboardDir.pathname);

    expect(files.filter((file) => readFileSync(file, 'utf8').match(cssImportPattern))).toEqual([]);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return sourceFiles(path);
    if (path.endsWith('.ts') || path.endsWith('.tsx')) return [path];
    return [];
  });
}
