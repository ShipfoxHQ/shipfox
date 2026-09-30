# @shipfox/registry-client

Renders the Shipfox Registry pages at `www.shipfox.io/registry` from the registry
API.

## What it does

- **Catalog** (`/registry`) lists templates and actions, featured ones first.
  Readers can search and filter by kind. The search and the kind live in the
  URL (`?q=` and `?kind=`), so every filtered view can be linked.
- **Package page** (`/registry/{namespace}/{name}`) shows the latest version.
  It renders the structured fields of the version document, the README, and
  every version with its changelog. A template page also shows the prompt to
  adopt it, and an action page shows its usage snippet.
- **Sitemap** (`/registry/sitemap.xml`) lists the catalog and every package page,
  with canonical URLs under `REGISTRY_CLIENT_PUBLIC_URL`.

Every page reads the API on the server, through the paths of
[`@shipfox/registry-format`](../../libs/shared/registry/format). No metadata is
authored in this app.

## Installation and setup

The app is private. It is a Next.js server with the base path `/registry` and
`output: 'standalone'`, so it runs as a container. For local development, start
the registry API (see [`@shipfox/registry`](../registry)), then:

```sh
mise exec -- pnpm --filter @shipfox/registry-client dev
```

The pages are at `http://localhost:16130/registry`. `.env` points
`REGISTRY_URL` at the local registry on port 16120.

Build the image with:

```sh
mise exec -- pnpm --filter @shipfox/registry-client image
```

The image runs the standalone server on port 3000. Set `REGISTRY_URL` and
`REGISTRY_CLIENT_PUBLIC_URL` when you start the container.

## Deployment

`www.shipfox.io/registry` is served by a Vercel project built from
`vercel.json`, the way the docs are. The cloud landing app proxies `/registry`
to it through its `REGISTRY_BASE_URL`. Set these on the Vercel project:

- `REGISTRY_URL`: `https://api.registry.shipfox.io` in production and
  `https://api.registry.staging.shipfox.io` in staging.
- `REGISTRY_CLIENT_PUBLIC_URL`: `https://www.shipfox.io/registry`, so canonical
  links and the sitemap use the public host and base path.

## Usage

Open a package page by its registry name:

```sh
curl -s http://localhost:16130/registry/shipfox/ticket-to-pr
```

## Environment

`src/config.ts` owns the variables and their descriptions: `REGISTRY_URL` for the
API, and `REGISTRY_CLIENT_PUBLIC_URL` for canonical links. The server reads them
at runtime, so one image serves any registry.

## Behavior notes

- **Freshness.** Catalogs, package indexes, and publisher profiles are cached for
  60 seconds, so a new version appears within a minute. Version documents and
  READMEs never change once published, so they are cached with no expiry.
- **Nothing renders at build time.** The API is only reachable at runtime. The
  catalog renders per request from cached reads. Package pages render on first
  visit and regenerate at most once a minute.
- **Publisher text is data.** READMEs and changelogs render as CommonMark with
  tables. Raw HTML and images are dropped. Only absolute `http(s)` links and
  anchors stay links, with `rel="nofollow ugc noopener"`.
- **Related packages** link only when the catalog lists them.
- **Signatures are not checked here.** The pages only display a version. Instances
  verify the envelope against their own trusted keys before they use one.

## Development

Tests start a fixture registry API on a local port and render the pages against
it.

```sh
turbo check --filter=@shipfox/registry-client
turbo type --filter=@shipfox/registry-client
turbo test --filter=@shipfox/registry-client
turbo build --filter=@shipfox/registry-client
```

## License

MIT
