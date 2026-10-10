# E2E Setup Auth

E2E helpers that create users and sessions, sign a browser in, and run the agent access OAuth flow.

## What it does

- **`createUser`** creates a verified user through the `/__e2e/auth/users` route.
- **`generateUser`** builds unique user credentials without calling the API.
- **`createSession`** creates a session through the `/__e2e/auth/sessions` route and returns the token with its refresh `Set-Cookie` header.
- **`parseSetCookie`** reads the name, value, and path from a `Set-Cookie` header, so a cookie session can be installed in any HTTP client or browser context.
- **`loginAs`** creates a session for a user and installs its refresh cookie in a Playwright page.
- **`registerAgentAccessClient`, `requestAgentAccessConsent`, and `authorizeAgentAccess`** register a loopback OAuth client and approve its consent for a workspace.
- **`createAuthHelper` and `authHelper`** bundle the helpers as a Playwright fixture named `auth`.

## Installation and setup

```sh
pnpm add @shipfox/e2e-setup-auth @shipfox/e2e-core
```

The helpers call `/__e2e` routes with the administrator key from [`@shipfox/e2e-core`](https://github.com/ShipfoxHQ/shipfox/blob/main/e2e/core/README.md). The API under test must run with `E2E_ENABLED=true` and an `E2E_ADMIN_API_KEY` that matches the key the suite sends.

## Usage

Create a user and install a session in a browser page:

```ts
import {createUser, loginAs} from '@shipfox/e2e-setup-auth';
import {test} from '@shipfox/e2e-core/playwright';

test('opens the app signed in', async ({page}) => {
  const user = await createUser();
  await loginAs(page, user);
  await page.goto('/');
});
```

Parse a session cookie for a plain HTTP client:

```ts
import {createSession, parseSetCookie} from '@shipfox/e2e-setup-auth';

const session = await createSession({user_id: userId});
const {name, value, path} = parseSetCookie(session.setCookie);
```

## Environment

The package reads the variables listed in [E2E Core](https://github.com/ShipfoxHQ/shipfox/blob/main/e2e/core/README.md#environment).

## Development

Run the package checks from the repository root:

```sh
turbo check --filter=@shipfox/e2e-setup-auth
turbo type --filter=@shipfox/e2e-setup-auth
turbo build --filter=@shipfox/e2e-setup-auth
turbo test --filter=@shipfox/e2e-setup-auth
```

## License

MIT
