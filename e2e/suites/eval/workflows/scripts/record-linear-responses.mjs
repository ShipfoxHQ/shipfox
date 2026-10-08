// One-off, manual: calls the 12 ported Linear read tools once against the sandbox Linear
// workspace and writes each raw CallToolResult to e2e/drivers/linear/recordings/<tool>.json.
// Run from this package: `node --env-file-if-exists=../../../../.env.local scripts/record-linear-responses.mjs`
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {parse} from 'yaml';

const TOOLS = [
  'get_issue',
  'get_issue_status',
  'get_project',
  'get_team',
  'get_user',
  'list_comments',
  'list_issue_statuses',
  'list_issues',
  'list_projects',
  'list_teams',
  'list_users',
  'search_documentation',
];
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
  if (typeof value !== 'string' || !value.startsWith('$fixture.')) return value;
  const [, provider, name, field] = value.split('.');
  const resolved = sandbox[provider]?.fixtures?.[name]?.[field];
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

for (const tool of TOOLS) {
  const file = tool.replaceAll('_', '-');
  const contractCase = parse(await readFile(join(contracts, 'linear', `${file}.yaml`), 'utf8'));
  const step = contractCase.steps[0];
  const args = resolve(step.with);
  const result = await client.callTool({name: tool, arguments: args});
  if (result.isError) throw new Error(`${tool} failed: ${JSON.stringify(result.content)}`);
  await writeFile(
    join(outputDirectory, `${tool}.json`),
    `${JSON.stringify({tool, arguments: args, result}, null, 2)}\n`,
  );
  process.stdout.write(
    `${tool}: ${result.content.length} block(s), structuredContent=${'structuredContent' in result}\n`,
  );
}
await client.close();
