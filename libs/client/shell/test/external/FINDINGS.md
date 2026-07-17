# External composition findings

Both the linked iteration mode and packed-tarball exit gate passed on 2026-07-16. The verifier
computed and installed a 12-package `@shipfox/*` runtime closure.

## Declaration portability

The packed consumer's `tsc --noEmit` accepted a typed `Link` and `useSearch` for the added
`/workspaces/$wid/insights` route. The generated router also resolved the toy package's emitted
default `defineRoute(...)` declarations and the shell's anchor return types from `dist`.

The packed verifier also checks that every installed `#*` import map defaults to `./dist/*` and
that representative shell and toy-feature public entrypoints resolve beneath `dist`. This keeps the
proof valid even while the tarballs still include source files.

The proof exposed two package-boundary gaps before it passed:

- Compiled client packages still mapped internal `#*` imports directly to `src`. Their package
  manifests now use `workspace-source` and `development` for source, and `default` for `dist`.
- The inferred anchor declarations name `@tanstack/router-core`. The shell now declares that direct
  dependency so isolated pnpm consumers can resolve it.

The fixture did not need `@storybook/react` at runtime or during its consumer type-check. The
`ShellProviders` declaration's type-only Storybook import is erased at runtime; the fixture uses the
same `skipLibCheck` setting as the existing external-consumer verifier.

## Development-mode coverage

The gate intentionally proves production builds and default package resolution; it does not start a
Vite development server. The `development` condition still resolves to the TypeScript source that
the packages currently ship. Plugin watch and regeneration behavior remains covered by ENG-961's
focused tests. If published packages stop including source, external development-mode support needs
a separate product decision and proof rather than making this release gate longer.

## Generated-file developer experience

The generated file keeps both forms of route implementation specifier readable:

- App-local implementations use a path relative to `src/shipfox-app.gen.ts`, such as
  `./features/override-impl`.
- Packaged implementations use an exported package subpath, such as
  `@shipfox/client-shell-fixture-feature/routes/insights`.

The app's Node-evaluated feature manifest imports local TypeScript modules without a `.js` suffix so
jiti resolves the source file. Route implementation modules are never evaluated by jiti.

## Collision diagnostic

The rejected build returned this diagnostic and a non-zero status:

```text
Route "/workspaces/$wid/insights" is contributed by both features "fixture.toy-feature" and "fixture.unapproved-collision". Set override: true to replace it explicitly.
```
