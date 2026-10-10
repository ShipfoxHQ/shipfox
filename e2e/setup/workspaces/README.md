# E2E Setup Workspaces

E2E helpers that create workspaces and invitations.

## What it does

- **`createWorkspace`** creates a workspace owned by a user through the `/__e2e/workspaces` route.
- **`createInvitation`** invites an email address to a workspace through the `/__e2e/workspaces/invitations` route.
- **`createWorkspacesHelper` and `workspacesHelper`** bundle the helpers as a Playwright fixture named `workspaces`.

## Installation and setup

```sh
pnpm add @shipfox/e2e-setup-workspaces @shipfox/e2e-core
```

The helpers call `/__e2e` routes with the administrator key from [`@shipfox/e2e-core`](../../core/README.md). The API under test must run with `E2E_ENABLED=true`.

## Usage

Create a workspace for a user:

```ts
import {createUser} from '@shipfox/e2e-setup-auth';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';

const user = await createUser();
const workspace = await createWorkspace({
  userId: user.user.id,
  userEmail: user.email,
  name: 'Billing E2E',
});
```

## Environment

The package reads the variables listed in [E2E Core](../../core/README.md#environment).

## Development

Run the package checks from the repository root:

```sh
turbo check --filter=@shipfox/e2e-setup-workspaces
turbo type --filter=@shipfox/e2e-setup-workspaces
turbo build --filter=@shipfox/e2e-setup-workspaces
turbo test --filter=@shipfox/e2e-setup-workspaces
```

## License

MIT
