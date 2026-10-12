# E2E Kit

Shared configuration, suite setup, fixtures, and app-shell page objects for Shipfox E2E suites.

## What it does

- **Config factories** `defineClientE2eConfig` and `defineApiE2eConfig` build Playwright configs from consumer-owned setup hooks.
- **Suite context** stores serializable global-setup state for workers and teardown processes.
- **Fixtures** arrange ready users, workspaces, and projects for client suites.
- **UI page objects** expose shared navigation, settings, dialogs, tables, logout, and stable screenshots.
- **Workspace URLs** centralize common workspace routes and URL patterns.

## Installation and setup

Install the package in an E2E consumer:

```sh
pnpm add @shipfox/e2e-kit
```

The consumer must provide its own global setup path. The setup should run the E2E preflight check before creating suite data.

## Usage

Build a client Playwright config with consumer-owned hooks:

```ts
import {defineClientE2eConfig} from '@shipfox/e2e-kit/config';

export default defineClientE2eConfig({
  buildName: 'e2e-client-settings',
  globalSetup: './tests/global-setup.ts',
  globalTeardown: './tests/global-teardown.ts',
});
```

Use shared shell actions in a browser test:

```ts
import {TopNav} from '@shipfox/e2e-kit/ui';

const topNav = new TopNav(page);
await topNav.logout();
```

Use suite context when global setup shares state with workers:

```ts
import {writeSuiteContext} from '@shipfox/e2e-kit/suite-context';

writeSuiteContext({
  runId: 'run-id',
  userId: 'user-id',
  workspaceId: 'workspace-id',
  sessionToken: 'session-token',
  org: 'e2e-org',
  connectionId: 'connection-id',
  connectionSlug: 'connection-slug',
  testVcsConnectionId: 'vcs-connection-id',
  testVcsAccountId: 'vcs-account-id',
  testVcsConnectionSlug: 'vcs-connection-slug',
  modelProviderId: 'model-provider-id',
  agentModel: 'model',
  fakeModelProviderRunId: 'provider-run-id',
  fakeModelProviderScripts: {},
});
```

## Development

Run the package checks from the repository root:

```sh
turbo check --filter=@shipfox/e2e-kit
turbo type --filter=@shipfox/e2e-kit
turbo build --filter=@shipfox/e2e-kit
turbo test --filter=@shipfox/e2e-kit
```

## License

MIT
