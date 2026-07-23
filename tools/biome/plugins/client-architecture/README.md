# Client-architecture Biome plugins

This directory holds Biome GritQL rules for client source. The root
[`biome.json`](../../../../biome.json) loads each rule for production files in
`libs/client/**` and `libs/shared/react/ui/**`.

Each rule should be small. It should show a clear error at the code that needs
the change. Keep each example short so the expected result is easy to see.

## Rules

- Give each rule a kebab-case name, such as `no-raw-api-request.grit`. Its rule
  id is `client-architecture/<name>`.
- Add `allowed.ts` and `rejected.ts` under `fixtures/<name>/` for each rule.
  Cover aliases, namespace imports, and type-only imports when they apply.
- Keep fixtures out of normal package checks. The fixture config includes them
  and skips tests, stories, and generated files.
- Put the rule id and the approved replacement boundary in each diagnostic.
  Do not fix a client-architecture error with `biome-ignore`.
- Keep rules local and based on source shape. Put cross-file checks, ownership
  data, runtime flow, and behavior tests in
  `@shipfox/client-architecture-policy` or a focused test.

The production rules currently cover:

- `no-api-dto-in-core` and `no-client-framework-in-core` for `src/core/**`.
- `no-response-dto-in-presentation` for pages and components.
- `no-raw-api-request` outside `@shipfox/client-api` and checked adapter paths.
- `no-query-cache-ownership` for leaf components; named coordinators and
  mutation/query adapters remain the ownership boundary.

`fixture-boundary.grit` is the smoke rule for this foundation. Its sentinel is
not a migrated production rule. Later issues add real rules beside it.

## Fixture harness

Run the focused harness with:

```sh
pnpm --filter=@shipfox/biome test
```

The harness uses the same `shipfox-biome-check` wrapper as package checks. It
opts into `biome.fixture.json` for the fixture tree. It checks the rule id,
replacement text, source location, and pass/fail result.
