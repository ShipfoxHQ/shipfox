# Policy Notice

Shared schemas and types for customer-facing policy notices.

## What it does

- **`requiredActionSchema` and `RequiredAction`** describe an action that helps a customer resolve a policy restriction.
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

## Development

```sh
turbo check --filter=@shipfox/policy-notice
turbo type --filter=@shipfox/policy-notice
turbo test --filter=@shipfox/policy-notice
```

## License

MIT
