import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {jamAgentToolCatalog} from '../dist/core/agent-tools.js';
import {DEFAULT_JAM_MCP_ENDPOINT} from '../dist/core/mcp-client.js';

const token = process.env.JAM_TOKEN;
if (!token) throw new Error('JAM_TOKEN is required');

const endpoint = process.env.JAM_MCP_ENDPOINT ?? DEFAULT_JAM_MCP_ENDPOINT;
// The provider adds this constant to `searchJams`, so Jam requires it and the catalog does not.
const providerSuppliedRequired = {searchJams: ['v']};

const client = new Client({name: 'shipfox-jam-tools', version: '0.0.0'});
await client.connect(
  new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: {headers: {authorization: `Bearer ${token}`}},
  }),
);

const listed = await client.listTools();
const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
const failures = [];
for (const expected of jamAgentToolCatalog) {
  const actual = byName.get(expected.id);
  if (!actual) {
    failures.push(`${expected.id}: missing`);
    continue;
  }
  const expectedRequired = JSON.stringify(
    [
      ...(expected.inputSchema.required ?? []),
      ...(providerSuppliedRequired[expected.id] ?? []),
    ].sort(),
  );
  const actualRequired = JSON.stringify([...(actual.inputSchema?.required ?? [])].sort());
  if (expectedRequired !== actualRequired) {
    failures.push(`${expected.id}: required inputs changed (${actualRequired})`);
  }
  const upstreamProperties = Object.keys(actual.inputSchema?.properties ?? {});
  for (const property of Object.keys(expected.inputSchema.properties ?? {})) {
    if (!upstreamProperties.includes(property)) {
      failures.push(`${expected.id}: input ${property} no longer exists`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write('Jam MCP compatibility failures\n');
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `All ${jamAgentToolCatalog.length} allow-listed tools are compatible with ${endpoint}\n`,
  );
}
await client.close();
