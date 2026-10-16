# Claap integration

Claap provider for Shipfox: connect a Claap workspace with a pasted API key, replace the key, and give agent steps and tool steps read-only access to Claap recordings.

## What it does

- **Claap provider** registers Claap with the `agent_tools` capability. It proxies five read tools from Claap's hosted MCP server: `list_workspaces`, `get_recordings`, `get_recording`, `get_recording_transcript`, and `search_recording_transcripts`.
- **Connect** takes a `cla_` key, asks Claap which workspace it belongs to, and creates one connection per Claap workspace.
- **Replace key** swaps the key of a connection. Claap must say that the new key belongs to the same workspace. A connection in `error` returns to `active`. A disabled one stays disabled.
- **ClaapInstallation** stores the Claap workspace ID and name, the last four characters of the key, and a credential version.
- **ClaapCredentialStore** stores API keys in the secrets module.
- **Claap E2E route** creates seeded connections for integration tests.

## Installation and setup

Add the workspace package to an API integration package:

```json
{
  "dependencies": {
    "@shipfox/api-integration-claap": "workspace:*"
  }
}
```

The provider has no feature flag. The integrations module loads it on every API start.

## Usage

```ts
import {
  createClaapCredentialStore,
  claapSecretsNamespace,
} from '@shipfox/api-integration-claap';

const store = createClaapCredentialStore({resolveConnection, secrets});
await store.setApiKey({connectionId, apiKey: 'cla_example'});
const namespace = claapSecretsNamespace(connectionId);
```

The `./agent-tools` export gives the tool catalog without loading the database or the MCP client.

## Environment

The shared integrations configuration owns `CLAAP_MCP_ENDPOINT`. It defaults to `https://api.claap.io/mcp`. Point it at a compatible fake for E2E runs.

## Data model

The package owns the `integrations_claap_installations` migration unit. The API key is never stored in PostgreSQL. It lives in the secrets module at `system/integrations/claap/<connectionId>` under `API_KEY`.

## Behavior notes

- **Auth.** Claap's MCP takes the key as `Authorization: Bearer cla_…`. Its REST API uses `X-Claap-Key`, which this package does not use.
- **Key scope.** A key belongs to one Claap workspace and acts as a workspace admin. The same endpoint offers write tools, so the read-only catalog is the safety boundary. The provider refuses any tool ID outside the catalog before it reaches Claap.
- **Workspace ID.** No tool schema contains `workspaceId`. The provider adds it from the connection to the four workspace-scoped tools and sends `list_workspaces` with empty arguments.
- **Share URLs.** `get_recording` and `get_recording_transcript` accept `recordingId` or `recordingUrl`, and exactly one. The URL must be an `https://app.claap.io` share URL of the connected Claap workspace.
- **Sensitive tools.** `get_recordings`, `get_recording`, `get_recording_transcript`, and `search_recording_transcripts` are marked sensitive, so tool-step logs redact their arguments and results. Even the metadata list names participants, companies, and deals.
- **Errors.** HTTP 401 becomes `credentials-unavailable`. Other 4xx and invalid parameters become `provider-rejected`. 429 becomes `rate-limited`, a timeout or 408 becomes `timeout`, and 5xx or network failures become `provider-unavailable`. An `isError` result passes through unchanged.
- **Connection state.** Only an HTTP 401 marks the connection `error`, while opening a session or on a call. Claap answers a revoked key with 401 on any request. An `isError` result never does, because Claap reports a wrong workspace ID the same way. The credential version guard keeps a late failure from an old key from undoing a key replacement.
- **Rate limits.** Claap limits each workspace to 3,000 calls per day, shared by every key.

## Development

```sh
mise exec -- turbo check --filter=@shipfox/api-integration-claap
mise exec -- turbo type --filter=@shipfox/api-integration-claap
mise exec -- turbo test --filter=@shipfox/api-integration-claap
```

The test suite uses the repository PostgreSQL service.

To check the catalog against the live Claap MCP, build the package and run the compatibility script with a key:

```sh
mise exec -- turbo build --filter=@shipfox/api-integration-claap
CLAAP_API_KEY=cla_… node libs/api/integration/claap/scripts/check-mcp-compatibility.mjs
```

The script exits 1 when Claap changes a tool the catalog copies.

## License

MIT
