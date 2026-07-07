# Model Provider E2E Driver

`@shipfox/e2e-driver-model-provider` provides a deterministic OpenAI-compatible
provider for E2E tests. It is strict test infrastructure: suites register it as a
normal custom model provider through product HTTP routes, while the fake model provider
itself stays outside the API app.

Use `startFakeOpenAiModelProvider()` for suites that need the provider to outlive
Playwright `globalSetup` and serve worker-process jobs:

```ts
import {message, startFakeOpenAiModelProvider, toolCall} from '@shipfox/e2e-driver-model-provider';

const provider = await startFakeOpenAiModelProvider({runId});
const script = await provider.createScript({
  id: `${runId}-agent-output-tool`,
  model: 'deterministic-output-agent',
  responses: [
    toolCall('set_output', {key: 'message', value: 'qwen-tool-output-ok'}),
    message('done'),
  ],
});

await provider.stop();
```

The provider writes `.context/e2e-model-provider/<runId>.json` with the child
pid, base URL, and admin token. Global teardown can call
`stopFakeOpenAiModelProvider({runId})` when the original handle is not available.

## HTTP Surface

Control endpoints require the server admin token:

```text
GET  /healthz
POST /scripts
POST /scripts/:scriptId/reset
GET  /scripts/:scriptId/requests
```

Provider-compatible endpoints bind to `127.0.0.1` and intentionally do not
require auth:

```text
POST /scripts/:scriptId/v1/chat/completions
```

Scripts advance one response per provider request. Exhausted scripts return
`409 script_exhausted`; assertion failures return `422 script_assertion_failed`.
