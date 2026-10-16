# Jam integration

Jam provider, token connection, credential storage, and read-only agent tools over Jam's hosted MCP server.

## What it does

- **Jam provider** registers Jam with the `agent_tools` capability. It has no events.
- **Token connection** takes a Jam personal access token, validates it, and creates one connection named `Jam` per Jam workspace.
- **Token replacement** swaps the token on an existing connection and reactivates it.
- **JamInstallation** stores the Jam workspace ID, the Jam user the token acts as, a token hint, and a credential version for one connection.
- **JamCredentialStore** stores the token in the secrets module.
- **JamAgentToolsProvider** proxies a ten-tool read-only catalog to Jam's MCP server.
- **Jam E2E route** creates seeded connections for integration tests.

## Installation and setup

Add the workspace package to an API integration package:

```json
{
  "dependencies": {
    "@shipfox/api-integration-jam": "workspace:*"
  }
}
```

The provider is always registered. It has no feature flag.

## Usage

```ts
import {createJamIntrospectionClient, createJamTokenValidator} from '@shipfox/api-integration-jam';

const validateToken = createJamTokenValidator({
  introspection: createJamIntrospectionClient(),
});
const {teamId, userName} = await validateToken('jam_pat_example');
```

The connect route is `POST /integrations/jam/connect`. The replace route is `PUT /integrations/jam/connections/:connectionId/token`.

## Environment

The shared integrations configuration owns `JAM_MCP_ENDPOINT` and `JAM_API_BASE_URL`. Their defaults point at Jam. Override them only for a compatible proxy or an E2E fake.

## Data model

The package owns the `integrations_jam_installations` migration unit. It stores the Jam workspace ID (`team_id`), the token's Jam user (ID, name, and email), the last four characters of the token, and a credential version. The token is never stored in PostgreSQL. It lives in the secrets module under `system/integrations/jam/<connectionId>`.

## Behavior notes

**Token validation.** Connect and replace both run the same checks before they write anything:

1. The token starts with `jam_pat_`.
2. Jam's introspection endpoint reports the token as active, and its scopes include `mcp:read`. A token made for the CLI only has no MCP scope, and every read tool would fail.
3. `listMembers` over the MCP finds the token's user. This proves the token reaches the MCP and can call a read tool.

The connection's external account ID is the Jam workspace ID (`team_id`), so one connection stands for one Jam workspace whichever user's token it holds.

**Replacement.** A new token must belong to the same Jam workspace. A token from another user of that workspace is accepted, and the settings page then shows the new user. A replacement whose token fails validation leaves the old token and the connection status unchanged. The credential version guard serializes concurrent replacements and keeps a late failure from an old token from undoing one.

**Catalog.** Jam lists every tool, write tools included, whatever the scopes of the token. The catalog is the safety boundary: the provider never forwards a tool outside it and never forwards Jam's server instructions, which tell the agent to post a comment. Schemas are copied from Jam's `tools/list` without `$schema`, the optional `intent`, and the `v` of `searchJams`, which the provider sets to `1`. A `jamId` can be a UUID or a `jam.dev` link, and the provider forwards it unchanged.

**Image tools.** `getScreenshots` and `getFrames` return images. A tool step reads JSON results only, so the provider rejects both for tool steps with `provider-rejected`. Agent steps receive the image blocks as Jam returns them.

**Results.** Jam answers with JSON in text blocks. Some "nothing here" answers are prose, not errors, and pass through as text. A Jam that does not exist or that the token's user cannot see comes back as an error result starting with `JamNotFound`; the provider adds `structuredContent.code = 'not-found'` so a tool step can tell.

**Errors.** HTTP 401 at session initialize means the token was revoked or has expired. The provider marks the connection `error` under the credential version guard and fails the call with `credentials-unavailable`. Other 4xx responses map to `provider-rejected`, 429 to `rate-limited`, timeouts to `timeout`, and 5xx or network failures to `provider-unavailable`.

## Compatibility check

Run the check by hand against the live MCP server. It fails when a catalog tool disappears or when its required or declared inputs drift.

```sh
mise exec -- turbo build --filter=@shipfox/api-integration-jam
JAM_TOKEN=jam_pat_example mise exec -- node libs/api/integration/jam/scripts/check-mcp-compatibility.mjs
```

## Development

```sh
mise exec -- turbo check --filter=@shipfox/api-integration-jam
mise exec -- turbo type --filter=@shipfox/api-integration-jam
mise exec -- turbo test --filter=@shipfox/api-integration-jam
```

The test suite uses the repository PostgreSQL service.

## License

MIT
