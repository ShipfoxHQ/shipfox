# E2E Setup Agent

E2E helpers that configure model providers and read agent sessions.

## What it does

- **`createOllamaCustomProvider` and `createOpenAiCompatibleCustomProvider`** register a workspace custom model provider that points at Ollama or another OpenAI-compatible endpoint.
- **`requireOllamaModel` and `ollamaConfig`** check that the Ollama model a suite needs is available, and fail with a fix when it isn't.
- **`createAnthropicModelProviderConfig` and `createAnthropicFakeModelProviderConfig`** create Anthropic provider configurations, the second one against a scripted fake.
- **`registerScriptedManagedProvider`, `registerOpenRouterManagedProvider`, `getScriptedManagedProviderRequests`, and `getOpenRouterCost`** control and read the managed provider that the API composes under `E2E_ENABLED`.
- **`scriptedManagedProviderEntriesSchema`** validates the replies of the scripted managed provider, the shape of a suite's `scripted.yaml`.
- **`listModelProviderConfigs` and `deleteModelProviderConfig`** read and remove provider configurations.
- **`getSessionTranscript`** reads the verbatim transcript of an agent session.
- **`createAgentHelper` and `agentHelper`** bundle the helpers as a Playwright fixture named `agent`.

## Installation and setup

```sh
pnpm add @shipfox/e2e-setup-agent @shipfox/e2e-core
```

The helpers call `/__e2e` routes with the administrator key from [`@shipfox/e2e-core`](https://github.com/ShipfoxHQ/shipfox/blob/main/e2e/core/README.md). The API under test must run with `E2E_ENABLED=true` and an `E2E_ADMIN_API_KEY` that matches the key the suite sends.

## Usage

Register a custom provider backed by a local Ollama model:

```ts
import {createOllamaCustomProvider} from '@shipfox/e2e-setup-agent';

const provider = await createOllamaCustomProvider({
  workspaceId,
  sessionToken: session.token,
});
```

## Environment

| Variable | Purpose |
| --- | --- |
| `OLLAMA_BASE_URL` | Ollama base URL. `SHIPFOX_OLLAMA_BASE_URL` is an alias. |
| `SHIPFOX_OLLAMA_MODEL` | Ollama model the suite expects. |

The package also reads the variables listed in [E2E Core](https://github.com/ShipfoxHQ/shipfox/blob/main/e2e/core/README.md#environment).

## Development

Run the package checks from the repository root:

```sh
turbo check --filter=@shipfox/e2e-setup-agent
turbo type --filter=@shipfox/e2e-setup-agent
turbo build --filter=@shipfox/e2e-setup-agent
turbo test --filter=@shipfox/e2e-setup-agent
```

## License

MIT
