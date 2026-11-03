# Integration core

`@shipfox/api-integration-core` composes integration providers and exposes their connection, source-control, webhook, and agent-tool behavior.

## What it does

- **`createIntegrationsContext`** builds the integrations module, provider registry, source-control service, and webhook processor.
- **Agent-tool services** authorize frozen tool configurations, load provider sessions, and record tool-call outcomes.
- **Built-in providers** can expose agent tools without an `IntegrationConnection` row. A provider module declares `builtinConnection: {slug, id}`. The integrations context adds that connection to workspace tool snapshots and resolves its fixed active connection during authorized tool calls.

- **Internal providers** set `internal: true`. `registry.list` leaves them out, so no gallery, picker, connection list, or capability snapshot shows them, and `registry.get` and `registry.find` still return them. The managed repository provider is internal. Its hidden connection is created on first use by `createManagedProjectRepository`, writes no `INTEGRATION_CONNECTION_AVAILABLE` event, and refuses `PATCH` and `DELETE` with `403 integration-connection-internal`.

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

A built-in provider still needs an `agent_tools` adapter. Its `openSession` receives the synthetic active connection and, when called by a workflow step, the caller context with workspace, project, run, job execution, step, and attempt identifiers. A conversation has no run, so its caller context carries the project, conversation, turn, and call item instead.

A conversation reaches only the tools in a provider's optional `conversationCatalog`. The `listConversationTools` inter-module method offers them, and `callTool` refuses anything else for a conversation caller. A provider without that catalog offers a conversation nothing.

A provider with an `interaction` adapter lets people talk to agents through it. Triggers and Agent reach it through the `readInteraction`, `sendInteractionReply`, and `reportInteractionProgress` inter-module methods, and `listInteractionProviders` returns each provider's events, context schema, and reply guidance for definition sync. An event the adapter doesn't list reads as `null`. `reportInteractionProgress` answers `reported: false` for a provider without `reportProgress`. The provider acknowledges a request in its webhook path, so acknowledgment isn't part of the adapter. `createFakeInteractionProvider` from `@shipfox/api-integration-spi/testing` stands in for a provider in tests.

To call tools without the module, build a registry with `createIntegrationProviderRegistry` and pass it to `createIntegrationsInterModulePresentation`. Its `callTool` handler is the one tool steps reach, with the live catalog and method checks and the error codes. The integration contract suite runs its cases through it against the provider fakes.

## Behavior notes

- `shipfox` is reserved for the first-party built-in provider. Users cannot create a connection with that slug.
- The well-known `SHIPFOX_BUILTIN_CONNECTION_ID` identifies the first-party synthetic connection.
- Built-in providers must not depend on connection secrets or database rows for their provider connection.
- The frozen step configuration keeps `connectionId`, `connectionSlug`, and `provider` so rolling deployments can read existing materialized steps.
- **File tools** have `result: 'file'` in the catalog. Agents never see them over MCP. A leased action step downloads their bytes from `POST /runs/jobs/current/integration-tools/download`, which the provider's `downloadFile` adapter serves. The route streams at most 100 MiB and stops at the smaller of `x-shipfox-deadline` (remaining milliseconds) and 5 minutes.
- **Image tools** have `result: 'image'` in the catalog. Agents see them over MCP and receive the image blocks. A tool step cannot call one: definition validation reports `integration-tool-agent-only`. An action cannot either: the generated action tool types leave it out and the action endpoint refuses the call.

- **Config reads** serve a project's `.shipfox/` tree from its source repository through `getConfigSource`, `listConfigFiles`, `readConfigFile`, and `listConfigCommits`, and through `GET /projects/:projectId/config`, `/config/files`, `/config/files/*`, and `/config/commits`. A project in another workspace answers `project-not-found`. The source header reads the owner, name, and default branch from the project row, so it still answers when the provider is down, with a `null` head. A row with no stored default branch asks the provider for it, so only that row fails during an outage. File and commit reads take an optional ref, which defaults to the default branch. The ref resolves to a commit id, and passing that id back reads the same tree on every page. Paths outside `.shipfox/` are refused. Commit history needs a source-control provider with `listCommits`; `history_supported` says whether it has one, and `listConfigCommits` answers `history-unsupported` without it.

- **Moving a managed project to a repository** runs in the request of `POST /projects/:projectId/config/link`, with no background job. The route checks the target (`config-exists`, `repository-in-use`, `repository-empty`, `connection-inactive`; `link-unsupported` for a provider with no `openConfigPullRequest`), and `dry_run: true` stops there. A move then makes the managed repository read-only (`linking`), opens a pull request that adds the `.shipfox/` tree from `refs/heads/main` on the branch `shipfox/link-config-<link_attempt_id>`, moves the project's source with `projects.moveProjectSource`, and finishes `linked`. An empty tree opens no pull request. A definite refusal (a provider refusal such as `permission-denied`, a pull request closed at the open, or `source-already-bound`) releases the repository to `active`. **An unknown outcome (a timeout, an outage, a crash) never releases it**: the route answers `503 move-unconfirmed` and a repeat `POST` resumes with the stored attempt and target, so a retry never opens a second pull request. Once the source moved, a resume goes straight to `linked`. Impersonated sessions can't start a move.
- **`getConfigSource` and `GET /projects/:projectId/config`** also return `move` (status, target, and who started it) and `pull_request`. While a pull request is stored, the read asks the provider for its state: `open`, `closed`, `merged` (which clears the stored URL, so the read stops), or `unknown` when the provider fails. The page never polls.
- **`POST /projects/:projectId/config/link/pull-request`** opens a new pull request after the current one reads `closed`, with a new attempt id and the tree at the head of the managed `main`. It refuses while the pull request is open or merged.
- **A provider opts in** with the optional `openConfigPullRequest` and `getConfigPullRequest` source-control methods. `openConfigPullRequest` looks for a pull request from the branch in any state before it writes, so a retry after a lost response returns the same one. GitHub and `test-vcs` implement both. The `moves` counter `integrations_config_link` carries only an `outcome` label.

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
