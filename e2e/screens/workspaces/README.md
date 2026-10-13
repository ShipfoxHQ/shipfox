# E2E Workspaces Screens

Typed browser page objects for Shipfox workspace onboarding, settings, and invitations.

## What it does

- **`WorkspaceOnboardingScreen`** creates a workspace from the onboarding page.
- **`WorkspaceHomeScreen`** navigates workspace home and settings routes.
- **`WorkspaceSetupChecklistScreen`** reads and controls the setup checklist.
- **`MembersSettingsScreen`** manages member and invitation views.
- **`InvitationAcceptScreen`** reads invitation pages and their controls.
- **`WorkspacesScreenFixtures` and `workspacesScreens`** add the workspace screens to a Playwright fixture.

## Installation and setup

Install the screen package with the E2E test tools:

```sh
pnpm add @shipfox/e2e-screens-workspaces @shipfox/e2e-kit @shipfox/e2e-core
```

The consumer must configure its API and client URLs through the E2E kit before running a suite.

## Usage

Compose the workspace screens into a client suite:

```ts
import {test as base} from '@shipfox/e2e-core/playwright';
import {WorkspaceHomeScreen, workspacesScreens} from '@shipfox/e2e-screens-workspaces';

const test = base.extend({...workspacesScreens});

test('opens a workspace', async ({page}) => {
  const workspace = new WorkspaceHomeScreen(page);
  await workspace.goto('e2e-workspace');
});
```

## Development

Run the package checks from the repository root:

```sh
turbo check --filter=@shipfox/e2e-screens-workspaces
turbo type --filter=@shipfox/e2e-screens-workspaces
turbo build --filter=@shipfox/e2e-screens-workspaces
turbo depcruise --filter=@shipfox/e2e-screens-workspaces
```

## License

MIT
