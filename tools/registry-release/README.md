# @shipfox/registry-release

Builds, checks, and publishes the first-party packages of the Shipfox Registry from this monorepo.

## What it does

The `shipfox-registry-release` command runs the deterministic recipe that turns a package directory into a registry version. The registry never builds: it validates what this tool uploads.

- **`build <dir>`** builds one package into `.shipfox-registry/<ns>/<name>/<version>/` (ignored by Git) and prints its digests. The directory holds the blobs, `README.md` when present, the publish `draft.json`, and a `build.json` summary. The registry's operator `import` command reads it.
- **`check --mode pr`** builds every configured package. A package whose fingerprint differs from its published version needs a pending changeset that bumps it by at least the computed minimum. An unpublished package needs no changeset.
- **`check --mode release`** builds every configured package and compares it with the registry. A published version must keep its fingerprint. A new version must meet the bump rules against the highest lower published version, and every action a template uses must be a published action or part of the same release.
- **`publish`** runs `check --mode release`, exchanges a GitHub OIDC token for a publish token, then uploads the versions the registry does not have. Actions upload before templates.
- **`verify <ns/name@version>`** checks out the provenance commit of a published version in a temporary worktree, runs the recipe, and compares the content and source digests.

`check` also warns about a `related` name that is neither published nor configured. It never fails on one.

### Template recipe, version 1

1. Parses `template.yaml` as a template manifest.
2. Composes every role binding with the default options, then the richest binding with no options and with each option choice alone. It parses each result with the workspace workflow schema.
3. Collects the `uses:` references. Every one must be an exact registry reference, never a repository path.
4. Encodes the `template-bundle@1` from `template.yaml`, `workflow.yml`, `GUIDE.md`, and `parts/**`, and the `source-archive@1` from the Git-tracked text files of the package.
5. Reads the optional `README.md` and the `## <version>` section of `CHANGELOG.md`, and stamps the composition format.

`libs/shared/workflow/templates/embedded-templates.yaml` is never read.

### Action recipe, version 1

1. Reads `action.yml` and `package.json`. `@shipfox/actions` in `dependencies` fails the build: the runner provides it, so it belongs in `devDependencies`. Other workspace packages are bundled from source.
2. Runs `turbo prune <package> --production` into a temporary build tree, which keeps the monorepo layout.
3. Trims the root files, so unrelated monorepo changes do not change the source archive:
   - the root `package.json` keeps `name`, `private`, and `packageManager`;
   - `pnpm-workspace.yaml` and the lockfile keep only the catalog entries the kept packages or `overrides` use;
   - the lockfile's root importer is emptied, and packages no production dependency reaches are dropped;
   - `turbo.json`, `turbo.jsonc`, and `.gitignore` are removed, because the install and the bundle never read them.
4. Runs `pnpm install --frozen-lockfile --ignore-scripts --prod` in the tree. pnpm enforces `minimumReleaseAge` from the copied `pnpm-workspace.yaml` on frozen installs, so a dependency published less than 2 days ago fails the build.
5. Bundles `main` with the pinned esbuild: `platform: node`, `format: esm`, `target: node24`, the `workspace-source` condition, `@shipfox/actions` external, legal comments at the end, no minify or source maps, and a `createRequire` banner. No tsconfig file is read. A `require` or `import()` esbuild cannot resolve fails the build, and so does a native `.node` file.
6. Encodes the `action-bundle@1` from `action.yml` with `main: index.mjs`, `index.mjs`, and `LICENSE` when present, and the `source-archive@1` from the build tree without `node_modules`. The resolved production dependencies are recorded from the trimmed lockfile.

The source digest depends on the action's path, on the bundled workspace packages, and on the root install settings the tree keeps, such as `overrides` and `packageExtensions`. A change to any of them needs a changeset for the action.

## Installation and setup

The package is private and is not published. Build it and its libraries with Turbo, then run it from the repository root:

```sh
turbo build --filter=@shipfox/registry-release...
```

## Usage

```sh
node tools/registry-release/dist/cli.js check --mode pr
```

`registry.config.yaml` names the registry, the namespace, and the package directories. The package name is the directory name.

```yaml
registry: https://api.registry.shipfox.io
namespace: shipfox
packages:
  - {kind: action, path: libs/shared/workflow/catalog/actions/*}
  - {kind: template, path: libs/shared/workflow/catalog/templates/*}
```

| Option | Effect |
| -- | -- |
| `--config <path>` | Uses another config file. The repository root is two directories above it. |
| `--registry <url>` | Overrides the registry URL, for a staging rehearsal or a local registry. It is also the OIDC audience. |

## Environment

`publish` reads two variables that GitHub Actions sets in a job with `id-token: write`:

| Variable | Purpose |
| -- | -- |
| `ACTIONS_ID_TOKEN_REQUEST_URL` | Where to request the OIDC token. |
| `ACTIONS_ID_TOKEN_REQUEST_TOKEN` | Bearer for that request. |

## Behavior notes

- The action recipe runs `turbo` and `pnpm` from this tool's directory, so mise picks the versions pinned by the repository. esbuild has an exact catalog pin, because a new esbuild version can change every action's bundle.
- The fingerprint comes from `@shipfox/registry-format`. Pull request checks compare it with the published version named in `package.json`.
- The tool reads the signed version envelope without verifying its signature. It only compares fingerprints and manifests in CI, and it never decides what runs.
- A template source archive holds tracked files only, so run a build after committing. An action build tree also holds untracked files that `.gitignore` does not exclude.

## Development

```sh
turbo check --filter=@shipfox/registry-release
turbo type --filter=@shipfox/registry-release
turbo test --filter=@shipfox/registry-release
turbo build --filter=@shipfox/registry-release
```

Tests build fixture templates and a fixture pnpm monorepo in throwaway Git repositories, and run the checks against an in-memory fake registry. The fixture monorepo installs from the local pnpm store; its lockfile is `test/fixtures/action-repository.lock.yaml`.

## License

MIT
