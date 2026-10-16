# @shipfox/e2e-driver-claap

Helpers to seed, read, and control the Claap fake that the E2E harness starts.

## What it does

The harness runs the fake (`e2e/harness/src/claap-mock.mjs`) in its own process, at `CLAAP_MCP_ENDPOINT`. Like Claap's hosted MCP, it is stateless: every request is a plain POST answered with JSON and no session ID. It answers the five read tools Shipfox exposes. Claap is read-only for Shipfox, so the driver has no `writes()`.

The fake holds no data of its own. It rejects a key without a seed with HTTP 401 and an empty body, as Claap rejects a key it does not know. A call that names another workspace ID than the key's fails as Claap fails it.

- **`seedClaapMock({apiKey, seed})`** gives a key its Claap workspace and the recordings in it, typed as **`ClaapMockSeed`** and **`ClaapMockRecording`**. Each spec seeds keys of its own, because a Shipfox workspace holds one connection per Claap workspace.
- **`claapMockCalls(apiKey)`** returns the tool calls the fake received for a key, in order, typed as **`ClaapMockCall`**.
- **`claapMockMcpRequestCount(apiKey)`** counts every MCP request the fake received for a key, initialize included.
- **`waitForClaapMockCall(apiKey)`** polls until the first tool call for a key arrives.
- **`revokeClaapKey(apiKey)`** makes the fake reject a key with HTTP 401 on every later request. A key whose value contains `revoked` is rejected from the start.
- **`releaseClaapCall(apiKey)`** answers the calls the fake holds for a key whose value contains `stale`. They fail with HTTP 401 if the key is revoked by then, and return their result otherwise.

## Installation and setup

The driver is a private workspace package. Add it to a suite:

```sh
pnpm add @shipfox/e2e-driver-claap --workspace
```

Run the suite through the harness (`mise run e2e`). The harness starts the fake and sets `CLAAP_MCP_ENDPOINT`.

## Usage

```ts
import {claapMockCalls, seedClaapMock} from '@shipfox/e2e-driver-claap';

await seedClaapMock({
  apiKey: 'cla_flow_1',
  seed: {
    workspace: {workspaceId: 'flowWs1', name: 'Flow'},
    recordings: [
      {
        recordingId: 'flowRec1',
        title: 'Bug report',
        url: 'https://app.claap.io/bug-report-c-flowWs1-flowRec1',
        createdAt: '2026-10-16',
        transcript: [{speaker: 'Ada', text: 'The checkout fails.'}],
      },
    ],
  },
});

// Connect a Shipfox workspace with the same key and workspace, run a workflow, then:
expect(await claapMockCalls('cla_flow_1')).toHaveLength(1);
```

## Environment

| Variable | Use |
| --- | --- |
| `CLAAP_MCP_ENDPOINT` | Where the API reaches the fake's MCP, and where the driver reaches its `/__e2e` routes. The harness sets it to `/mcp` at API + 21. |

## Development

```sh
turbo check --filter=@shipfox/e2e-driver-claap
turbo type --filter=@shipfox/e2e-driver-claap
```

The fake's tests live in `e2e/harness/test/claap-mock.test.mjs` and run with `turbo test --filter=@shipfox/e2e-harness`.

## License

MIT
