# @shipfox/registry-release

Builds, checks, and publishes the first-party packages of the Shipfox Registry from this monorepo.

## What it does

The `shipfox-registry-release` command runs the deterministic recipe that turns a package directory into a registry version. The registry never builds: it validates what this tool uploads.

- **`build <dir>`** builds one package into `.shipfox-registry/` (ignored by Git) and prints its digests.
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

The action recipe is not available yet, so `build` rejects a package of kind `action`.

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

- The fingerprint comes from `@shipfox/registry-format`. Pull request checks compare it with the published version named in `package.json`.
- The tool reads the signed version envelope without verifying its signature. It only compares fingerprints and manifests in CI, and it never decides what runs.
- The source archive holds tracked files only, so run a build after committing.

## Development

```sh
turbo check --filter=@shipfox/registry-release
turbo type --filter=@shipfox/registry-release
turbo test --filter=@shipfox/registry-release
turbo build --filter=@shipfox/registry-release
```

Tests build fixture templates in throwaway Git repositories and run the checks against an in-memory fake registry.

## License

MIT
