# @shipfox/docs

The user-facing documentation app, written as [Mintlify](https://mintlify.com/)
`.mdx` files. It is served at `https://www.shipfox.io/docs`. `docs.json` holds the
navigation, theme, and site configuration.

## Render locally

```sh
pnpm --filter=@shipfox/docs dev            # serve with live reload at http://localhost:3000
pnpm --filter=@shipfox/docs broken-links   # report broken internal links
```

Both scripts run the Mintlify CLI through `npx`, so the first run downloads it (it
bundles a preview server, so expect a larger initial download). You can also install
it globally if you prefer:

```sh
npm i -g mint
cd apps/docs && mint dev
```

## Layout

- `docs.json` — navigation, theme, colors, logo, and the GitHub link.
- `index.mdx` — the docs home page.
- `*.mdx` — one file per page; the path under `apps/docs/` is the page URL.
- `logo/`, `favicon.svg` — brand assets referenced from `docs.json`.

## Why the Mintlify CLI runs via `npx`, not as a dependency

`mint` pulls React 18-era packages (`@mintlify/mdx`, `next-mdx-remote-client`), and
this monorepo is React 19 with `strictPeerDependencies: true`, so the CLI cannot be
installed as a normal workspace dependency. Running it through `npx` gives it an
isolated install with its own React, which is also what Mintlify expects.

The package intentionally defines no `build`, `check`, `type`, or `test` scripts, so
Turborepo skips it for those tasks — only `turbo dev` picks up the docs preview.
