import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

// Altitude guard for the page-level RTL harness (`test/pages.tsx`), which mounts a
// memory router + QueryClient + API client. That weight is justified for a page
// test or a component that genuinely fetches and navigates; it is pure overhead
// for a presentational component (use a plain `render()`) or a router-only
// component (use `renderWithRouter` from `test/render.tsx`).
//
// This is a soft cap, not a ban: a new harness user must be added here on purpose,
// which is the point at which a reviewer asks whether the test needs page wiring.
// See CONTRIBUTING.md "Unit Testing Strategy (Client Apps)".
const PAGE_HARNESS_ALLOWLIST = [
  'src/components/workflow-run-summary/workflow-run-attempt-switcher.test.tsx',
  'src/components/workflow-run-view/workflow-run-view.test.tsx',
  'src/pages/workflow-run-page.test.tsx',
];

const srcDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(srcDir);

function collectTestFiles(dir: string): string[] {
  return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) return collectTestFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.test.tsx') ? [entryPath] : [];
  });
}

describe('page harness budget', () => {
  it('is imported only by the allowlisted page-wiring tests', () => {
    const harnessImporters = collectTestFiles(srcDir)
      .filter((file) => readFileSync(file, 'utf8').includes("'#test/pages"))
      .map((file) => relative(packageRoot, file))
      .sort();

    expect(harnessImporters).toEqual(PAGE_HARNESS_ALLOWLIST);
  });
});
