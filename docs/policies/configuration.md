# Configuration policy

This policy owns repository-wide environment rules. Read it when an app or
package reads an environment variable. Also read it when you change a validator
or document a setting. A package README owns local meaning and setup. Code,
schemas, deployment manifests, and generated references own exact runtime
values, defaults, and accepted inputs.

Keep the rules close to the code.
Use plain text.

## Own configuration where it is read

Each app and package that reads environment variables owns a flat
`src/config.ts`. It calls `createConfig` from `@shipfox/config`. Use one
validator for each variable it reads. Keep the schema first. Derive helpers
below it.

Use the validator that matches the value: `str`, `num`, `bool`, `host`, `port`,
`url`, or `email`. A validator with a `default` is optional. Without a default,
the setting is required. Startup fails when it is missing or invalid.

`@shipfox/config` owns the library API and validator behavior. Read its
[package README](../../libs/shared/common/config/README.md) when using or
changing that package. Do not duplicate package-local setup or environment
semantics here.

## Describe every setting

Give every validator a `desc`. Write it for a self-hoster in plain language:

- State what the setting does and how to set it.
- List accepted values for constrained settings.
- State when a setting is required or depends on another setting.
- Use one present-tense idea per sentence and no marketing language.

Do not use a `//` comment beside a config parameter. The description stays with
the schema. It appears in missing-config failures. A source comment does not.

```ts
export const config = createConfig({
  AUTH_JWT_SECRET: str({
    desc: 'Secret used to sign and verify user access tokens. Required, with no default, so startup fails when it is missing.',
  }),
  MAILER_TRANSPORT: str({
    desc: 'How emails are delivered. Use console to write emails to the log, or smtp to send through an SMTP server.',
    default: 'console',
  }),
});
```

## Preserve executable ownership

Do not keep a hand-written copy of an app's environment contract in a
repository-wide document. The owning `src/config.ts` and deployment manifest
define current defaults and accepted inputs. Package READMEs explain local setup.
They also explain constraints that code cannot express.

Authentication secrets and token lifetime are not general configuration rules.
When changing an Auth token or its setting, read the
[Auth security model](../../libs/api/auth/README.md#security-model), which owns
that trust boundary and its lifetime constraints.
