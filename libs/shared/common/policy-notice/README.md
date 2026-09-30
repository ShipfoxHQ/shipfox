# Policy Notice

Shared schemas and types for customer-facing policy notices.

## What it does

- **`requiredActionSchema` and `RequiredAction`** describe an action that helps a customer resolve a policy restriction. The `url` is the target every surface can open. It is an absolute `https` URL, an application-relative path, or a `mailto:` URL.
- **`intent`** is an optional string on a required action. It names a behavior the composing application may provide in place of opening `url`. A reader that doesn't handle the intent, including an unknown value, opens `url`.
- **`REQUIRED_ACTION_INTENTS`** holds the known intents. `contactSupport` is `'contact-support'`.
- **`policyNoticeSchema` and `PolicyNotice`** describe a stable reason, customer-facing message, and optional required action.

## Installation and setup

```sh
pnpm add @shipfox/policy-notice
```

## Usage

```ts
import {policyNoticeSchema} from '@shipfox/policy-notice';

const notice = policyNoticeSchema.parse({
  reason: 'workspace-limit',
  message: 'This workspace cannot use that runner.',
  requiredAction: {
    reason: 'billing-payment-required',
    message: 'Add credits to use larger runners.',
    url: '/settings/billing',
  },
});
```

An action that asks the composing application to put the user in touch with support keeps a working `mailto:` fallback:

```ts
import {REQUIRED_ACTION_INTENTS, requiredActionSchema} from '@shipfox/policy-notice';

const action = requiredActionSchema.parse({
  reason: 'workspace-limit',
  message: 'Contact us',
  url: 'mailto:support@example.com',
  intent: REQUIRED_ACTION_INTENTS.contactSupport,
});
```

`intent` is a free string, not an enum. Stored notices outlive code, so a retired or future value must still parse.

## Development

```sh
turbo check --filter=@shipfox/policy-notice
turbo type --filter=@shipfox/policy-notice
turbo test --filter=@shipfox/policy-notice
```

## License

MIT
