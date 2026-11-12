# @shipfox/email-compiler

## 0.1.0

### Minor Changes

- e586fe8: Email templates are compiled from MJML at build time, so `@shipfox/node-email` no longer installs `mjml` and its CSS tooling. That tooling gave packages installed alongside it, such as `@shipfox/node-temporal`, a second installed copy.

  The new `@shipfox/email-compiler` package provides the `shipfox-email-compile <source-dir> <out-dir>` command, which compiles each `<name>.mjml` file into `<name>.hbs`. It owns the shared partials and the template checks. To migrate a package that calls `createEmailRenderer`:

  - Add `@shipfox/email-compiler` as a development dependency and run `shipfox-email-compile emails dist/emails` in the build.
  - Point `templatesDir` at the output directory. The renderer reads `<name>.hbs` files.
  - Change shared partial includes from `@shipfox/node-email/partials/<name>.mjml` to `@shipfox/email-compiler/partials/<name>.mjml`.

  `EmailTemplateError` is no longer thrown for MJML errors, unknown partials, or bare block helpers. The compiler throws `EmailCompileError` for those at build time.
