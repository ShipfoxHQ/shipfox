# @shipfox/email-compiler

Build-time compiler that turns MJML email templates into the Handlebars HTML templates
`@shipfox/node-email` renders.

## What it does

- **`shipfox-email-compile <source-dir> <out-dir>`**: Compiles every `<name>.mjml` file
  directly in `<source-dir>` into `<out-dir>/<name>.hbs`. Every top-level `.mjml` file is a
  template, so keep a package's own partials in a subdirectory, which is skipped. Outputs
  whose template no longer exists are removed. Exits nonzero on the first invalid template.
- **`compileEmailTemplates({sourceDir, outDir})`**: The same compilation as a function. It
  returns the compiled template names.
- **`compileEmailTemplate({filePath})`**: Compiles one template and returns the HTML.
- **`EmailCompileError`**: Thrown, with the `templateName`, when a template is invalid
  MJML, includes an unknown shared partial, or has a bare block helper.
- **Shared chrome**: The Shipfox fonts, color tokens, header, and footer, as MJML partials.

## Installation and setup

```sh
pnpm add -D @shipfox/email-compiler
```

MJML brings CSS tooling (cssnano, postcss, svgo) that pnpm uses to fill the optional
peers of other packages in the same dependency graph. Install the compiler only where
it runs at build time, and never as a runtime dependency.

## Usage

Run the compiler in the package build, after the TypeScript output is written:

```json
{
  "scripts": {
    "build": "shipfox-swc && shipfox-email-compile emails dist/emails"
  }
}
```

A template includes the shared chrome by package specifier:

```xml
<mjml lang="en">
  <mj-head>
    <mj-include path="@shipfox/email-compiler/partials/head-styles.mjml" />
  </mj-head>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-include path="@shipfox/email-compiler/partials/header.mjml" />
        <mj-text>Hello {{name}}</mj-text>
        <mj-include path="@shipfox/email-compiler/partials/footer.mjml" />
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
```

Point `createEmailRenderer` from `@shipfox/node-email` at the output directory.

## Behavior notes

- **Shared partials.** `partials/head-styles.mjml`, `partials/header.mjml` and
  `partials/footer.mjml` exist. The compiler inlines them before MJML parses the
  template, because MJML denies includes that leave the template's directory. An unknown
  partial throws `EmailCompileError`.
- **Block helpers.** Handlebars runs on the compiled HTML, so a `{{#if}}` between MJML
  components is silently dropped and both branches render. Wrap it in `<mj-raw>`, for
  example `<mj-raw>{{#if x}}</mj-raw>`. The compiler throws `EmailCompileError` for a bare
  block helper. `{{#each}}` inside `mj-table` or `mj-text` works as written.
- **Logo.** The header partial uses `{{logoUrl}}`, which the `@shipfox/node-email`
  renderer fills in.

## Development

```sh
turbo check --filter=@shipfox/email-compiler
turbo type --filter=@shipfox/email-compiler
turbo test --filter=@shipfox/email-compiler
```

## License

MIT
