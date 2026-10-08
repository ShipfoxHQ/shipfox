// One-off, manual: runs the first step of each case below once against the sandbox Linear
// workspace and writes its raw CallToolResult to e2e/drivers/linear/recordings/<case>.json.
// An error case records the error the hosted MCP answers with. The request id of an error changes
// on every call, so it is set to zeros to keep the file the same on every recording.
// Run from this package: `node --env-file-if-exists=../../../../.env.local scripts/record-linear-responses.mjs`
import {mkdir, readFile, writeFile} from 'node:fs/promises';
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
  'get-issue-missing-issue',
  'list-issues-invalid-created-at',
];
const REFERENCE = /^\$(fixture|target)\./u;
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
await client.close();
