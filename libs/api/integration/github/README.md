# GitHub integration

`@shipfox/api-integration-github` provides GitHub App installation, connection, source-control, webhook, and recovery behavior.

## What it does

- **`createGithubIntegrationProvider`** composes the GitHub provider for the integrations module.
- **Installation routes** create and complete the existing GitHub App installation flow.
- **Link routes** authorize a Shipfox member with GitHub user OAuth and connect an accessible, unlinked installation, or let them choose one when there are several.
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
| `POST /integrations/github/link/complete` | Exchange the OAuth code, inspect every accessible installation, and connect one candidate or return candidates with a selection token. |
| `POST /integrations/github/link/select` | Connect one installation named by a selection token. |

The link flow carries its S256 PKCE verifier inside authenticated encrypted state. It requires the completing Shipfox actor's JWT and workspace membership. Existing installations are never repointed.

With 2 to 20 linkable installations, `/link/complete` returns their account names and a selection token. More than 20 return the `github-too-many-linkable-installations` conflict. The token is HMAC-signed with the install-state secret under its own signing domain. It binds the actor, the workspace, the allowed installation IDs, its purpose and version, and a five-minute expiry. It holds no GitHub token, and its payload is readable.

`/link/select` checks the current actor, workspace membership, the token, and that it allows the selected ID. It then fetches the installation with the app JWT and rejects suspended or deleted installations. It does not recheck the user's GitHub access: a revocation after the token was issued takes effect only when the token expires, at most five minutes later. The token is not single-use. Selecting an installation that is already linked to the workspace returns the existing connection.

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
