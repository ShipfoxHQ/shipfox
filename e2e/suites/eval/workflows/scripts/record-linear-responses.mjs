// One-off, manual: runs the first step of each case below once against the sandbox Linear
// workspace and writes its raw CallToolResult to e2e/drivers/linear/recordings/<case>.json.
// An error case records the error the hosted MCP answers with. The request id of an error changes
// on every call, so it is set to zeros to keep the file the same on every recording.
//
// It then runs every Linear round-trip case once, step by step, and writes the raw CallToolResult
// of the first call to each write tool to e2e/drivers/linear/recordings/writes/<tool>.json. That
// creates objects in the `sandbox-write` team, which stays acceptable in a sandbox.
//
// Run from this package, with `reads`, `writes`, or neither for both:
// `node --env-file-if-exists=../../../../.env.local scripts/record-linear-responses.mjs writes`
import {randomUUID} from 'node:crypto';
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {parse} from 'yaml';

const CASES = [
  'get-issue',
  'get-issue-status',
  'get-project',
  'get-team',
  'get-user',
  'list-comments',
  'list-issue-statuses',
  'list-issues',
  'list-projects',
  'list-teams',
  'list-users',
  'search-documentation',
  'get-document',
  'get-milestone',
  'list-cycles',
  'list-documents',
  'list-issue-labels',
  'list-milestones',
  'list-project-labels',
  'list-releases',
  'list-release-pipelines',
  'list-release-notes',
  'list-agent-skills',
  'get-status-updates',
  'get-attachment',
  'extract-images',
  'get-release-missing-release',
  'get-release-note-missing-release-note',
  'get-agent-skill-missing-agent-skill',
  'get-issue-missing-issue',
  'list-issues-invalid-created-at',
];
const REFERENCE = /^\$(fixture|target)\./u;
const PHASES = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['reads', 'writes'];
const here = dirname(fileURLToPath(import.meta.url));
const contracts = join(here, '../cases/contracts');
const outputDirectory = join(here, '../../../../drivers/linear/recordings');
const token = process.env.LINEAR_SANDBOX_TOKEN;
if (!token) throw new Error('LINEAR_SANDBOX_TOKEN must be set.');

const sandbox = parse(await readFile(join(contracts, 'sandbox.yaml'), 'utf8'));

function resolve(value) {
  if (Array.isArray(value)) return value.map(resolve);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]));
  }
  if (typeof value !== 'string' || !REFERENCE.test(value)) return value;
  const [, provider, name, field] = value.split('.');
  const resolved = (sandbox[provider]?.fixtures?.[name] ?? sandbox[provider]?.targets?.[name])?.[
    field
  ];
  if (resolved === undefined) throw new Error(`Unknown fixture reference ${value}.`);
  return resolved;
}

const client = new Client({name: 'linear-contract-recorder', version: '0.0.0'});
await client.connect(
  new StreamableHTTPClientTransport(new URL('https://mcp.linear.app/mcp'), {
    requestInit: {headers: {authorization: `Bearer ${token}`}},
  }),
);
await mkdir(outputDirectory, {recursive: true});

if (PHASES.includes('reads')) {
  for (const file of CASES) {
    const contractCase = parse(await readFile(join(contracts, 'linear', `${file}.yaml`), 'utf8'));
    const step = contractCase.steps[0];
    const tool = step.tool;
    const args = resolve(step.with);
    const result = await client.callTool({name: tool, arguments: args});
    if (Boolean(result.isError) !== (contractCase.kind === 'error')) {
      throw new Error(`${file} answered ${JSON.stringify(result.content)}`);
    }
    await writeFile(
      join(outputDirectory, `${file}.json`),
      `${JSON.stringify({tool, arguments: args, result}, null, 2).replaceAll(/requestId\\":\\"[0-9a-f]+/gu, 'requestId\\":\\"0000000000000000')}\n`,
    );
    process.stdout.write(
      `${file}: ${result.content.length} block(s), structuredContent=${'structuredContent' in result}\n`,
    );
  }
}
// A write step's `with` can name an earlier step's result with `$steps.<key>.<path>` and the run
// with `$marker`, in the whole value or inside a string.
const REFERENCES = /\$(fixture|target|steps|marker)((?:\.[A-Za-z0-9_]+)*)/gu;

function resolveStep({value, steps, marker}) {
  if (Array.isArray(value)) return value.map((item) => resolveStep({value: item, steps, marker}));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveStep({value: item, steps, marker})]),
    );
  }
  if (typeof value !== 'string') return value;
  return value.replaceAll(REFERENCES, (reference, kind, rest) => {
    if (kind === 'marker') return marker;
    const path = rest.slice(1).split('.');
    const resolved =
      kind === 'steps'
        ? path.slice(1).reduce((item, key) => item?.[key], steps[path[0]])
        : (sandbox[path[0]]?.fixtures?.[path[1]] ?? sandbox[path[0]]?.targets?.[path[1]])?.[
            path[2]
          ];
    if (resolved === undefined) throw new Error(`Unresolved reference ${reference}.`);
    return String(resolved);
  });
}

async function callStep(tool, args) {
  const result = await client.callTool({name: tool, arguments: args});
  if (result.isError) throw new Error(`${tool} answered ${JSON.stringify(result.content)}`);
  return result;
}

if (PHASES.includes('writes')) {
  const writesDirectory = join(outputDirectory, 'writes');
  await mkdir(writesDirectory, {recursive: true});
  const recorded = new Set();
  const files = (await readdir(join(contracts, 'linear')))
    .filter((file) => file.endsWith('-round-trip.yaml'))
    .sort();
  for (const file of files) {
    const contractCase = parse(await readFile(join(contracts, 'linear', file), 'utf8'));
    const marker = `contract-${randomUUID()}`;
    const steps = {};
    for (const step of contractCase.steps) {
      const args = resolveStep({value: step.with, steps, marker});
      const result = await callStep(step.tool, args);
      if (step.key) steps[step.key] = JSON.parse(result.content[0].text);
      if (!recorded.has(step.tool)) {
        recorded.add(step.tool);
        await writeFile(
          join(writesDirectory, `${step.tool}.json`),
          `${JSON.stringify({tool: step.tool, arguments: args, result}, null, 2)}\n`,
        );
        process.stdout.write(`${step.tool}: ${result.content.length} block(s)\n`);
      }
    }
  }
}
await client.close();
