# Shipfox Runner Labels

Shared runner label canonicalization and validation helpers.

## Contract

`canonicalizeLabels(value)` accepts `undefined`, one string, or an array of
strings. It trims labels, lowercases them, drops empty values, deduplicates, and
sorts the result. A single string is one label; it is not split on commas.

`parseLabelList(value)` is for comma-delimited configuration values such as
`DEFINITION_DEFAULT_RUNNER_LABEL`. It splits on commas, then applies the same
canonicalization contract.

Post-canonicalization labels must match `/^[a-z0-9][a-z0-9._-]*$/`, so labels
start with a lowercase ASCII letter or digit and may then contain lowercase
letters, digits, `.`, `_`, and `-`. A label may be at most 64 characters.
Callers that own a complete label set should cap it at 20 labels.

That comma behavior is deliberate: `runner: ubuntu,gpu` in YAML is one invalid
label, while `DEFINITION_DEFAULT_RUNNER_LABEL=ubuntu,gpu` configures two labels.

## Development

```sh
turbo check --filter=@shipfox/runner-labels
turbo type --filter=@shipfox/runner-labels
turbo test --filter=@shipfox/runner-labels
```
