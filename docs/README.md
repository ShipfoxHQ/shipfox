# Shipfox documentation

The user-facing documentation, written as [Mintlify](https://mintlify.com/)
`.mdx` files. It is served at `https://www.shipfox.io/docs`. `docs.json` holds
the navigation, theme, and site configuration.

## Render locally

Run these from the **repository root**:

```sh
pnpm docs:dev     # serve with live reload at http://localhost:3000
pnpm docs:check   # report broken internal links
```

Both commands run the Mintlify CLI through `npx`, so no global install is
needed. The first run downloads the CLI (it bundles a preview server, so expect
a larger initial download). You can also install it globally if you prefer:

```sh
npm i -g mint
cd docs && mint dev
```

## Layout

- `docs.json` — navigation, theme, colors, logo, and the GitHub link.
- `index.mdx` — the docs home page.
- `*.mdx` — one file per page; the path under `docs/` is the page URL.
- `logo/`, `favicon.svg` — brand assets referenced from `docs.json`.

## Not a workspace package

`docs/` is deliberately **not** part of the pnpm workspace, so it never becomes
a Turborepo package and stays out of `turbo build`, `turbo test`, and
`turbo check`. The Mintlify CLI reads these files directly. Keep it that way:
add pages and edit `docs.json`, but do not add a `package.json` here.
