#!/usr/bin/env node
// Regenerates the doc regions that are derived from source-of-truth modules, so
// the docs never drift from the product. Run `pnpm --filter=@shipfox/docs generate`
// to rewrite them, or `--check` (wired into `turbo test`) to fail on drift.
//
// Each generated region is delimited in the MDX by:
//   {/* generated:<id>:start ... */}  ...  {/* generated:<id>:end */}
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MODEL_PROVIDER_CATALOG_SEED} from '@shipfox/api-agent-dto';

const docsRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

/** @type {{file: string, id: string, render: () => string}[]} */
const regions = [
  {
    file: 'content/docs/reference/model-providers.mdx',
    id: 'model-providers',
    render: renderModelProvidersTable,
  },
];

function renderModelProvidersTable() {
  const supported = MODEL_PROVIDER_CATALOG_SEED.filter((p) => p.support_status === 'supported');
  const rows = supported.map((p) => `| ${p.label} | \`${p.id}\` | \`${p.default_model}\` |`);
  return ['| Provider | `provider` ID | Default model |', '|---|---|---|', ...rows].join('\n');
}

function applyRegion(source, id, body) {
  const start = `{/* generated:${id}:start`;
  const end = `{/* generated:${id}:end */}`;
  const startIdx = source.indexOf(start);
  const endIdx = source.indexOf(end);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Missing generated:${id} sentinels`);
  }
  const startLineEnd = source.indexOf('\n', startIdx);
  const head = source.slice(0, startLineEnd + 1);
  const tail = source.slice(endIdx);
  return `${head}${body}\n${tail}`;
}

let drift = false;
for (const region of regions) {
  const path = join(docsRoot, region.file);
  const current = readFileSync(path, 'utf8');
  const next = applyRegion(current, region.id, region.render());
  if (next === current) continue;
  if (check) {
    drift = true;
    // biome-ignore lint/suspicious/noConsole: CLI diagnostics
    console.error(
      `✗ ${region.file} (generated:${region.id}) is stale. Run: pnpm --filter=@shipfox/docs generate`,
    );
  } else {
    writeFileSync(path, next);
    // biome-ignore lint/suspicious/noConsole: CLI diagnostics
    console.log(`✓ wrote generated:${region.id} → ${region.file}`);
  }
}

if (check && drift) process.exit(1);
if (check) {
  // biome-ignore lint/suspicious/noConsole: CLI diagnostics
  console.log('✓ generated doc regions are up to date');
}
