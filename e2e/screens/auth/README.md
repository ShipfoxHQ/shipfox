# E2E Auth Screens

Typed browser page objects for Shipfox authentication and guest redirects.

## What it does

- **`LoginScreen`** navigates the login page and submits user credentials.
- **`SignupScreen`** navigates signup, creates an account, and reads signup feedback.
- **`GuestRedirectScreen`** checks the onboarding page shown after a guest redirect.
- **`AuthScreenFixtures` and `authScreens`** add the auth screens to a Playwright fixture.

## Installation and setup

Install the screen package with the E2E test tools:

```sh
pnpm add @shipfox/e2e-screens-auth @shipfox/e2e-core
```

The consumer must configure its API and client URLs through the E2E kit before running a suite.

## Usage

Compose the auth screens into a client suite:

```ts
import {test as base} from '@shipfox/e2e-core/playwright';
import {LoginScreen, authScreens} from '@shipfox/e2e-screens-auth';

const test = base.extend({...authScreens});

test('logs in', async ({page}) => {
  const login = new LoginScreen(page);
  await login.goto();
  await login.submit('user@example.com', 'password');
});
```

## Development

Run the package checks from the repository root:

```sh
turbo check --filter=@shipfox/e2e-screens-auth
turbo type --filter=@shipfox/e2e-screens-auth
turbo build --filter=@shipfox/e2e-screens-auth
turbo depcruise --filter=@shipfox/e2e-screens-auth
```

## License

MIT
