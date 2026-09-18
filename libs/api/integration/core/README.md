# Integration core

`@shipfox/api-integration-core` composes integration providers and exposes their connection, source-control, webhook, and agent-tool behavior.

## What it does

- **`createIntegrationsContext`** builds the integrations module, provider registry, source-control service, and webhook processor.
- **Agent-tool services** authorize frozen tool configurations, load provider sessions, and record tool-call outcomes.
- **Built-in providers** can expose agent tools without an `IntegrationConnection` row. A provider module declares `builtinConnection: {slug, id}`. The integrations context adds that connection to workspace tool snapshots and resolves its fixed active connection during authorized tool calls.

Built-in connections are YAML-level names. They are not manageable connections, do not appear in connection listings, and their slugs are reserved by the integration DTO package. Providers receive the typed `interModule` clients that the composition root supplies through `IntegrationProviderModuleLoadOptions`.

## Installation and setup

Add the package to a workspace package:

```json
{
  "dependencies": {
    "@shipfox/api-integration-core": "workspace:*"
  }
}
```

The application composition root must provide the clients and secrets required by its enabled providers. Use `defaultModules` from `@shipfox/api-server` for the standard server composition.

## Usage

The following fixture uses the `parts` test seam. Production enables and composes providers through `IntegrationProviderModule` instead of passing `parts`.

```ts
import {createIntegrationsContext} from '@shipfox/api-integration-core';

const integrations = await createIntegrationsContext({
  parts: [
    {
      provider: {
        provider: 'example',
        displayName: 'Example',
        adapters: {
          agent_tools: {
            catalog: () => [],
            selectionCatalog: () => ({selectors: []}),
            openSession: async () => ({call: async () => ({})}),
          },
        },
      },
      builtinConnection: {
        slug: 'example',
        id: '00000000-0000-4000-8000-000000000010',
      },
    },
  ],
});

console.log(integrations.registry.list());
```

A built-in provider still needs an `agent_tools` adapter. Its `openSession` receives the synthetic active connection and, when called by a workflow step, the caller context with workspace, project, run, job execution, step, and attempt identifiers.

## Behavior notes

- `shipfox` is reserved for the first-party built-in provider. Users cannot create a connection with that slug.
- The well-known `SHIPFOX_BUILTIN_CONNECTION_ID` identifies the first-party synthetic connection.
- Built-in providers must not depend on connection secrets or database rows for their provider connection.
- The frozen step configuration keeps `connectionId`, `connectionSlug`, and `provider` so rolling deployments can read existing materialized steps.

## Development

Run package checks from the repository root:

```sh
mise exec -- turbo check --filter=@shipfox/api-integration-core
mise exec -- turbo type --filter=@shipfox/api-integration-core
mise exec -- turbo test --filter=@shipfox/api-integration-core
```

The test suite uses the repository integration database services. Follow the local development workflow for service setup.

## License

MIT
