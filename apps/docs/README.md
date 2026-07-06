# @shipfox/docs

The user-facing documentation app, written as [Mintlify](https://mintlify.com/)
`.mdx` files. It is served at `https://www.shipfox.io/docs`. `docs.json` holds the
navigation, theme, and site configuration.

## Render locally

```sh
pnpm --filter=@shipfox/docs dev            # serve with live reload at http://localhost:3000
pnpm --filter=@shipfox/docs broken-links   # report broken internal links
```

The Mintlify CLI (`mint`) is a `devDependency` of this package, so `pnpm install`
provides it — no manual or global install needed.

## Layout

- `docs.json` — navigation, theme, colors, logo, and the GitHub link.
- `index.mdx` — the docs home page.
- `*.mdx` — one file per page; the path under `apps/docs/` is the page URL.
- `logo/`, `favicon.svg` — brand assets referenced from `docs.json`.

## Notes

- **React peer allowance.** `mint` ships packages built for React 18 while the repo is
  React 19. `pnpm-workspace.yaml` allows React 19 to satisfy those peers so the CLI
  installs under the strict peer policy; it renders correctly under React 19.
- **Turbo.** The package defines no `build`, `check`, `type`, or `test` scripts, so
  Turborepo skips it for those tasks — only `turbo dev` picks up the docs preview.
