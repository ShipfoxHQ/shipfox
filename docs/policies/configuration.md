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
`url`, or `email`. A `default` supplies a missing value in every environment.
Without an active default or fallback, the setting is required. Startup fails
when a required value is missing or any explicit value is invalid.

Use `devDefault` when a value is safe only outside production. It applies when
`NODE_ENV` is set and is not `production`; production still requires the
setting. Use `testDefault` when tests need a separate value.

Wrap a validator with `fallbackTo('SOURCE_KEY', validator)` when one setting
uses another setting as its fallback. Both keys must be in the same schema and
produce compatible types. The source default resolves before the dependent
validator checks the value.

`@shipfox/config` owns the library API and validator behavior. Read its
[package README](../../libs/shared/common/config/README.md) when using or
changing that package. Do not duplicate package-local setup or environment
semantics here.

## Choose between an environment variable and a flag

Ask these questions in order. The first "yes" decides.

| Question | Answer |
| --- | --- |
| Is it a secret, a URL, a credential, or an infrastructure size? | Environment variable. |
| Does it decide which module, provider, or adapter is wired at boot? | Environment variable. |
| Does it define the security or access posture of the instance? | Environment variable. |
| Does it need to change without a deploy, or differ by workspace or user? | Flag. |
| Is it a temporary gate for new work? | Flag. |
| Otherwise | Environment variable, or a constant if nobody changes it. |

When a feature needs both, split it. An environment variable says the capability is configured, such as the keys exist. A flag says who gets it.

A toggle that is on for everyone in production is not migrated to a flag. Delete it, and the enabled behavior becomes the only behavior. A flag that gates new work is removed in the pull request that follows its full rollout.

## Derive flag overrides from definitions

A package declares the flags it reads with `defineFlags` from `@shipfox/feature-flags`, next to its `config.ts`. A flag key is kebab-case and starts with its owning context, such as `definitions-actions`.

A flag is not a `createConfig` setting. Its environment override is derived from the definition:

- The variable is `FLAG_` plus the key in upper snake case: `definitions-actions` becomes `FLAG_DEFINITIONS_ACTIONS`.
- A boolean flag takes `true` or `false`. A config flag takes JSON, so a string value is quoted: `FLAG_LIMITS_CONCURRENCY_ENFORCEMENT='"enforce"'`.
- The definition's `desc` is the description. Do not add a `FLAG_*` validator to a `config.ts`.
- An empty variable is not an override.
- `defaultModules` checks every declared flag's override at startup. An invalid value or a duplicate key fails startup like any invalid environment value.

An override wins over the flag provider, which wins over the code default. The [feature flags ADR](../adr/0022-feature-flags-seam.md) owns the model.

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
