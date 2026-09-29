# GitHub integration

`@shipfox/api-integration-github` provides GitHub App installation, connection, source-control, webhook, and recovery behavior.

## What it does

- **`createGithubIntegrationProvider`** composes the GitHub provider for the integrations module.
- **Installation routes** create and complete the existing GitHub App installation flow.
- **Link routes** authorize a Shipfox member with GitHub user OAuth and connect one accessible, unlinked installation.
- **Source-control adapters** expose GitHub repositories and files to the integrations core.
- **Webhook processing** verifies and processes GitHub App deliveries.

## Installation and setup

Add the package to the server composition:

```json
{
  "dependencies": {
    "@shipfox/api-integration-github": "workspace:*"
  }
}
```

The application supplies the integrations core callbacks and enables the provider through its module configuration.

## Usage

```ts
import {createGithubIntegrationProvider} from '@shipfox/api-integration-github';

const provider = createGithubIntegrationProvider({
  github: githubClient,
  coreDb,
  getExistingGithubConnection,
  connectGithubInstallation,
  publishIntegrationEventReceived,
  publishSourceRepositoryUpdated,
  publishSourcePush,
  recordDeliveryOnly,
  getIntegrationConnectionById,
});
```

Production composition should use the provider module exported by the integrations server. The direct factory is useful for integration tests and composed provider setup.

## Environment

The provider reads the GitHub App credentials, webhook secret, API base URL, and install-state secret from the GitHub integration configuration. See [`src/config.ts`](src/config.ts) for the complete schema and descriptions.

## Routes

| Route | Purpose |
| --- | --- |
| `POST /integrations/github/install` | Create a GitHub App installation URL for a workspace. |
| `GET /integrations/github/callback/api` | Complete a GitHub App installation callback. |
| `POST /integrations/github/link` | Start actor-bound GitHub user OAuth for an existing installation. |
| `POST /integrations/github/link/complete` | Exchange the OAuth code, inspect every accessible installation, and connect one candidate. |

The link flow carries its S256 PKCE verifier inside authenticated encrypted state. It requires the completing Shipfox actor's JWT and workspace membership. Existing installations are never repointed. Multiple linkable installations return a typed conflict until the selection flow is available.

## Observability

The provider registers the service-level gauge `integrations_github_unlinked_installations`.
It counts installations recorded from lifecycle webhooks whose `first_seen_at` is more than
one hour old and whose installation is not linked. The gauge is intentionally a shared-state
observable gauge rather than a per-instance metric.

## Development

Run package checks from the repository root:

```sh
mise exec -- turbo check --filter=@shipfox/api-integration-github...
mise exec -- turbo type --filter=@shipfox/api-integration-github...
mise exec -- turbo test --filter=@shipfox/api-integration-github...
```

The route tests use fake GitHub clients. The persistence tests use the repository integration database services.

## License

MIT
