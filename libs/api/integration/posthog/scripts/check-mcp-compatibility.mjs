import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {posthogAgentToolCatalog} from '../dist/core/agent-tools.js';

const apiKey = process.env.POSTHOG_API_KEY;
if (!apiKey) throw new Error('POSTHOG_API_KEY is required');

const region = requiredEnv('POSTHOG_REGION');
if (region !== 'us' && region !== 'eu') {
  throw new Error('POSTHOG_REGION must be us or eu');
}
const regions = [region];
const endpoints = {
  us: 'https://mcp.posthog.com/mcp',
  eu: 'https://mcp-eu.posthog.com/mcp',
};

for (const region of regions) {
  const client = new Client({name: 'shipfox-posthog-tools', version: '0.0.0'});
  const transport = new StreamableHTTPClientTransport(new URL(endpoints[region]), {
    requestInit: {
      headers: {
        authorization: `Bearer ${apiKey}`,
        'x-posthog-mcp-mode': 'tools',
        'x-posthog-read-only': 'true',
        'x-posthog-project-id': requiredEnv('POSTHOG_PROJECT_ID'),
        'x-posthog-organization-id': requiredEnv('POSTHOG_ORGANIZATION_ID'),
      },
    },
  });

  await client.connect(transport);
  const listed = await client.listTools();
  const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
  const failures = [];
  for (const expected of posthogAgentToolCatalog) {
    const actual = byName.get(expected.id);
    if (!actual) {
      failures.push(`${expected.id}: missing`);
      continue;
    }
    const expectedRequired = JSON.stringify([...(expected.inputSchema.required ?? [])].sort());
    const actualRequired = JSON.stringify([...(actual.inputSchema?.required ?? [])].sort());
    if (expectedRequired !== actualRequired) {
      failures.push(`${expected.id}: required inputs changed (${actualRequired})`);
    }
  }

  if (failures.length > 0) {
    process.stderr.write(`${region}: compatibility failures\n`);
    for (const failure of failures) process.stderr.write(`- ${failure}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `${region}: all ${posthogAgentToolCatalog.length} allow-listed tools are compatible\n`,
    );
  }
  await client.close();
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
