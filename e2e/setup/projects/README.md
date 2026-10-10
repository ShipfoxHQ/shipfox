# E2E Setup Projects

E2E helper that creates projects.

## What it does

- **`createProject`** creates a project in a workspace through the `/__e2e/projects` route. Without a source, the project has no repository.
- **`createProjectsHelper` and `projectsHelper`** bundle the helper as a Playwright fixture named `projects`.

## Installation and setup

```sh
pnpm add @shipfox/e2e-setup-projects @shipfox/e2e-core
```

The helper calls `/__e2e` routes with the administrator key from [`@shipfox/e2e-core`](https://github.com/ShipfoxHQ/shipfox/blob/main/e2e/core/README.md). The API under test must run with `E2E_ENABLED=true` and an `E2E_ADMIN_API_KEY` that matches the key the suite sends.

## Usage

Create a project that uses a connection's repository as its source:

```ts
import {createProject} from '@shipfox/e2e-setup-projects';

const project = await createProject({
  workspaceId,
  name: 'Limits E2E',
  sourceConnectionId: connectionId,
  sourceExternalRepositoryId: externalRepositoryId,
  sourceRepositoryOwner: 'e2e',
  sourceRepositoryName: 'limits',
});
```

## Environment

The package reads the variables listed in [E2E Core](https://github.com/ShipfoxHQ/shipfox/blob/main/e2e/core/README.md#environment).

## Development

Run the package checks from the repository root:

```sh
turbo check --filter=@shipfox/e2e-setup-projects
turbo type --filter=@shipfox/e2e-setup-projects
turbo build --filter=@shipfox/e2e-setup-projects
turbo test --filter=@shipfox/e2e-setup-projects
```

## License

MIT
