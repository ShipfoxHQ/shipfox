import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {claapAgentToolCatalog} from '../dist/core/agent-tools.js';

const apiKey = process.env.CLAAP_API_KEY;
if (!apiKey) throw new Error('CLAAP_API_KEY is required');

const endpoint = process.env.CLAAP_MCP_ENDPOINT ?? 'https://api.claap.io/mcp';
// The two single-recording tools take recordingUrl, so their catalog schema has no required
// recordingId although Claap requires it.
const URL_TOOLS = new Set(['get_recording', 'get_recording_transcript']);
// list_workspaces is the connect probe and takes no workspace ID.
const UNSCOPED_TOOLS = new Set(['list_workspaces']);

const client = new Client({name: 'shipfox-claap-tools', version: '0.0.0'});
const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: {headers: {authorization: `Bearer ${apiKey}`}},
});

await client.connect(transport);
const listed = await client.listTools();
const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
const failures = [];
for (const expected of claapAgentToolCatalog) {
  const actual = byName.get(expected.id);
  if (!actual) {
    failures.push(`${expected.id}: missing`);
    continue;
  }
  const actualProperties = Object.keys(actual.inputSchema?.properties ?? {});
  const actualRequired = [...(actual.inputSchema?.required ?? [])].sort();

  if (UNSCOPED_TOOLS.has(expected.id)) {
    if (actualProperties.length > 0 || actualRequired.length > 0) {
      failures.push(
        `${expected.id}: expected no input but found properties (${actualProperties}) and required (${actualRequired})`,
      );
    }
    continue;
  }

  const expectedRequired = [
    ...(expected.inputSchema.required ?? []),
    'workspaceId',
    ...(URL_TOOLS.has(expected.id) ? ['recordingId'] : []),
  ].sort();
  if (JSON.stringify(expectedRequired) !== JSON.stringify(actualRequired)) {
    failures.push(
      `${expected.id}: required inputs changed (expected ${expectedRequired}, found ${actualRequired})`,
    );
  }
  for (const property of Object.keys(expected.inputSchema.properties ?? {})) {
    if (property === 'recordingUrl') continue;
    if (!actualProperties.includes(property)) {
      failures.push(`${expected.id}: input ${property} is missing upstream`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write('Claap compatibility failures\n');
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`all ${claapAgentToolCatalog.length} allow-listed tools are compatible\n`);
}
await client.close();
