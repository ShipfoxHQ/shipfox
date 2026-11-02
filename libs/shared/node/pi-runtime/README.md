# Shipfox Pi Runtime

Builds a pi model from resolved runtime credentials, the same way for a runner step and a server turn.

## What it does

- **`createPiModel(params)`**: Creates the pi `ModelRuntime`, registers a custom provider, finds the model, and checks that credentials exist.
- **`createInMemoryCredentialStore(credentials)`**: A credential store that keeps values in memory and writes nothing to disk.
- **`toPiRuntimeCredential(provider, credentials)`**: Turns resolved credentials into a pi API key credential, with provider fields such as `AZURE_OPENAI_BASE_URL`.
- **`registerCustomProvider(params)`**: Registers a workspace or managed provider after the host's egress check.
- **`resolveModel(modelRuntime, provider, modelId)`**: Finds a model or throws an `AgentConfigError` with a hint.
- **`wrapManagedProviderStream(streamSimple)`**: Marks an interrupted managed stream as retryable.
- **`piToolContent(content)`**: Converts MCP tool output to pi tool content.
- **`AgentConfigError`**: A user-fixable configuration failure, with an `agentConfigIssue` code.

## Installation and setup

```sh
pnpm add @shipfox/node-pi-runtime
```

The package imports `@earendil-works/pi-coding-agent`. That package loads a native image library, so a host that must not load it at startup imports this package with a dynamic `import()`.

## Usage

```ts
const {createInMemoryCredentialStore, createPiModel, toPiRuntimeCredential} = await import(
  '@shipfox/node-pi-runtime'
);

const credentials = {api_key: process.env.ANTHROPIC_API_KEY ?? ''};
const {modelRuntime, model} = await createPiModel({
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  thinking: 'medium',
  credentials,
  credentialStore: createInMemoryCredentialStore({
    anthropic: toPiRuntimeCredential('anthropic', credentials),
  }),
  customProvider: undefined,
  assertEgressAllowed: async () => undefined,
  modelsPath: null,
});
```

## Behavior notes

- **Egress is a hook.** `assertEgressAllowed(url, label)` runs before a custom provider is registered. Each host passes its own policy and maps a denial to an `AgentConfigError`.
- **`modelsPath: null` skips `models.json`.** Pi then reads and writes nothing under the home directory. The runner leaves it unset.
- **The caller owns the credential store.** The runner passes a store that renews managed tokens. The API passes an in-memory store.
- **`thinking: 'default'` drops `reasoning`.** The provider then uses its own default level.

## Development

```sh
turbo check --filter=@shipfox/node-pi-runtime
turbo type --filter=@shipfox/node-pi-runtime
turbo test --filter=@shipfox/node-pi-runtime
```

## License

MIT
