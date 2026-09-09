# Shipfox Config

Typed config for Shipfox packages. It checks `process.env` at startup and returns a typed object.

## What it does

- **`createConfig(schema, update?)`** resolves declared fallbacks and checks environment values with `envalid`.
- **`fallbackTo(key, validator)`** uses another validated schema value when the environment value is not set.
- **Common validators** are re-exported: `str`, `num`, `bool`, `email`, `host`, `port`, and `url`.
- **Fail-fast startup** means bad values throw before the app runs.

## Installation and setup

```bash
pnpm add @shipfox/config
# or
yarn add @shipfox/config
# or
npm install @shipfox/config
```

## Usage

```ts
import {bool, createConfig, fallbackTo, num, str, url} from '@shipfox/config';

const config = createConfig({
  NODE_ENV: str({choices: ['development', 'test', 'production']}),
  API_URL: url({devDefault: 'http://localhost:3000'}),
  API_PUBLIC_URL: fallbackTo('API_URL', url()),
  PORT: num({default: 3000}),
  DEBUG: bool({default: false}),
});

config.API_PUBLIC_URL; // string
config.PORT; // number
config.DEBUG; // boolean
```

`fallbackTo` accepts a key from the same schema with a compatible output type.
The source value resolves before the dependent validator checks it. A key that
declares `fallbackTo` cannot also declare a static or environment-specific
default; the source key can.

Pass `update` in tests to override `process.env`:

```ts
const testConfig = createConfig({PORT: num()}, {PORT: '4000'});
```

## Development

```sh
turbo check --filter=@shipfox/config
turbo type --filter=@shipfox/config
turbo test --filter=@shipfox/config
```

## License

MIT
