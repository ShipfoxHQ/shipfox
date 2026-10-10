# E2E Setup Integrations

E2E helpers that create integration connections, including the Test VCS fixture that gives a project a source without a Git host.

## What it does

- **`createTestVcsConnection` and `createTestVcsRepository`** create a Test VCS connection and a repository with files, so a project has a source without Gitea.
- **`getTestVcsStats`, `failNextTestVcsMints`, and `testVcsExternalRepositoryId`** read the fixture's request counters, fail the next token mints, and build the external repository ID of a fixture repository.
- **`createGithubConnection`, `createLinearConnection`, `createJiraConnection`, `createSentryConnection`, `createClickUpConnection`, `createDiscordConnection`, `createNotionConnection`, `createPosthogConnection`, and `createSlackConnection`** create a connection for the named provider without its OAuth flow.

## Installation and setup

```sh
pnpm add @shipfox/e2e-setup-integrations @shipfox/e2e-core
```

The helpers call `/__e2e` routes with the administrator key from [`@shipfox/e2e-core`](../../core/README.md). The API under test must run with `E2E_ENABLED=true`.

## Usage

Create a Test VCS connection and a repository with one file:

```ts
import {
  createTestVcsConnection,
  createTestVcsRepository,
} from '@shipfox/e2e-setup-integrations';

const connection = await createTestVcsConnection({workspaceId, accountId: 'e2e'});
const repository = await createTestVcsRepository({
  connectionId: connection.id,
  name: 'limits',
  files: [{path: 'README.md', content: '# Limits'}],
});
```

## Environment

The package reads the variables listed in [E2E Core](../../core/README.md#environment).

## Development

Run the package checks from the repository root:

```sh
turbo check --filter=@shipfox/e2e-setup-integrations
turbo type --filter=@shipfox/e2e-setup-integrations
turbo build --filter=@shipfox/e2e-setup-integrations
turbo test --filter=@shipfox/e2e-setup-integrations
```

## License

MIT
