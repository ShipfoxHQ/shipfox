# @shipfox/e2e-driver-jam

Helpers to read and control the Jam fake that the E2E harness starts.

## What it does

The harness runs the fake (`e2e/harness/src/jam-mock.mjs`) in its own process. It serves Jam's token introspection at `JAM_API_BASE_URL` and Jam's MCP at `JAM_MCP_ENDPOINT`. It answers the ten read tools and `listMembers` for the two sandbox Jams: a video and a screenshot. Image tools return image blocks.

This driver reads what the fake recorded and steers it through `/__e2e` routes. Jam is read-only for Shipfox, so the driver has no `writes()`.

The fake treats a token by its value:

| Token contains | The fake |
| --- | --- |
| `revoked` | Rejects every MCP request with HTTP 401, and introspects the token as `active: false`. |
| `cli-only` | Introspects the token without the `mcp:read` scope. |
| `stale` | Holds every tool call until `releaseJamCall`. |

## Installation and setup

The driver is a private workspace package. Add it to a suite:

```sh
pnpm add @shipfox/e2e-driver-jam --workspace
```

Run the suite through the harness (`mise run e2e`). The harness starts the fake and sets the environment below. Give each spec its own token, because the fake records calls by token.

## Usage

```ts
import {jamMockCalls, releaseJamCall, revokeJamToken, waitForJamMockCall} from '@shipfox/e2e-driver-jam';

// A connection with a `stale` token, and a run whose tool call is held by the fake.
await waitForJamMockCall(token);
await revokeJamToken(token); // later requests with the token fail with HTTP 401
await releaseJamCall(token); // the held call fails with HTTP 401, as a late failure does

expect(await jamMockCalls(token)).toHaveLength(1);
```

- `jamMockCalls(token)` and `jamMockMcpRequestCount(token)`: read the tool calls and the MCP requests the fake recorded for a token. The count includes `initialize`.
- `waitForJamMockCall(token)`: poll until the first call for a token arrives.
- `revokeJamToken(token)`: make the fake reject a token with HTTP 401 on every request after this call.
- `releaseJamCall(token)`: answer the calls held for a `stale` token. They fail with HTTP 401 if the token is revoked by then, and return their result otherwise.

## Environment

| Variable | Use |
| --- | --- |
| `JAM_API_BASE_URL` | Where the driver reaches the fake's `/__e2e` routes. The harness sets it to the port at API + 20. |
| `JAM_MCP_ENDPOINT` | Where the API reaches the fake's MCP. The harness sets it together with `JAM_API_BASE_URL`. |

## Development

```sh
mise exec -- turbo check type --filter=@shipfox/e2e-driver-jam...
mise exec -- pnpm --filter @shipfox/e2e-harness test
```

The fake's tests live in `e2e/harness/test/jam-mock.test.mjs`.

## License

MIT
