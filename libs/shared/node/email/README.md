# Shipfox Email

Branded transactional email templates for Shipfox Node packages. It renders compiled
MJML + Handlebars templates into the `{subject, html, text}` shape that
`@shipfox/node-mailer` sends.

## What it does

- **`renderEmail(name, data)`**: Renders a template into `{subject, html, text}`. The
  HTML is responsive, branded MJML; the `text` is a hand-written plain-text fallback.
- **`createEmailRenderer(options)`**: Builds a `renderEmail`-style function for templates
  owned by another package, with the shared Shipfox chrome. See
  [Extending the package](#extending-the-package).
- **`RenderedEmail`**: The `{subject, html, text}` result shape.
- **`EmailTemplateError`**: Thrown (naming the template) when a compiled template file is
  missing or a template name is not registered.

## Templates

| Name | Data | Sent by |
|------|------|---------|
| `verification-code` | `{verificationCode, expiresInMinutes}` | `@shipfox/api-email-challenges` on signup / resend |
| `verify-email` | `{verifyLink}` | `@shipfox/api-auth` on signup / resend |
| `reset-password` | `{resetLink, expiresInHours}` | `@shipfox/api-auth` on password reset request |
| `workspace-invitation` | `{email, workspaceName, inviterName, inviteLink}` | `@shipfox/api-workspaces` on invite |

## Usage

```ts
import {renderEmail} from '@shipfox/node-email';
import {mailer} from '#config.js';

const email = await renderEmail('verify-email', {
  verifyLink: 'https://app.shipfox.io/auth/verify-email?token=...',
});
await mailer.send({to: user.email, ...email});
```

## Extending the package

A package outside `@shipfox/node-email` can render its own branded emails. It keeps one
`<name>.mjml` file per template in a directory it owns, compiles them at build time with
[`@shipfox/email-compiler`](../../../../tools/email-compiler/README.md), and declares each
template's subject and plain-text body:

```json
{
  "scripts": {
    "build": "shipfox-swc && shipfox-email-compile emails dist/emails"
  }
}
```

```ts
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createEmailRenderer} from '@shipfox/node-email';

interface BillingTemplates {
  'balance-low': {workspaceName: string; billingUrl: string};
}

const render = createEmailRenderer<BillingTemplates>({
  // Holds balance-low.hbs, compiled from emails/balance-low.mjml.
  templatesDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'emails'),
  templates: {
    'balance-low': {
      subject: '{{workspaceName}} is running low on credits',
      text: ({workspaceName, billingUrl}) => `${workspaceName} is low on credits.\n${billingUrl}`,
    },
  },
});

const {subject, html, text} = await render('balance-low', data);
```

- **Compiled templates.** The renderer reads `<name>.hbs` files, so the package runs
  without MJML and its CSS tooling. The shared chrome, the `<mj-raw>` rule for block
  helpers, and the template checks are documented in the compiler README.
- **Logo.** `{{logoUrl}}` is injected by the renderer. Do not pass it in `data`.
- **Sanitising.** String values, including those nested in arrays and plain objects, are stripped
  of control characters before rendering. `{{var}}` HTML-escapes them.
- **Shipping.** The `templatesDir` must ship in your deployment image.

## Design notes

- The `.mjml` sources live in `emails/`. The build compiles them into `dist/emails/`, and
  the runtime reads that directory from both `src/` and `dist/`. MJML only runs at build
  time: its CSS tooling (cssnano, postcss, svgo) would otherwise reach every importer's
  dependency graph and fill optional peers of the Temporal webpack bundler, which gives
  shared packages a second installed copy.
- Shared chrome (fonts, color tokens, the logo partial) lives in `@shipfox/email-compiler`
  and is pulled in with `mj-include`.
- The Shipfox logo is served from the client app's own origin: `CLIENT_BASE_URL` +
  `/email-logo.png`. `@shipfox/client-shell` ships the asset and its Vite manifest plugin
  serves it, so any client composed with the shell answers that path. The package
  reads `CLIENT_BASE_URL` via `@shipfox/config`, so every deployment embeds its own logo
  URL and no recipient data leaks to a third-party CDN. The asset is a PNG because most
  mail clients do not render SVG.
- Colors come from the product design tokens (see `DESIGN.md`): heading `#0f0f10`, body
  `#52525b`, divider `#d4d4d8`, CTA fill `#1a1a1b`. Orange is reserved for the logo mark.
- Dark mode is forced to light (`color-scheme: light`) so clients do not invert the
  white card into unreadable dark-on-dark.
- All interpolation uses Handlebars `{{var}}` (HTML-escaped). User-controlled values
  (workspace name, inviter, email) must never use `{{{ }}}`. They are also stripped of
  control characters before rendering, so a name cannot fold the subject line or inject
  extra lines (a fake CTA, a phishing link) into the plain-text body.

## Development

```sh
turbo check --filter=@shipfox/node-email
turbo type --filter=@shipfox/node-email
turbo test --filter=@shipfox/node-email
```

## License

MIT
