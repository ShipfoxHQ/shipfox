# Dependency version policy

This policy defines what one version means in the Shipfox pnpm workspace. It
applies before a dependency is added, updated, or exempted.

**One version means one reviewed version intent. The intent is scoped to one
direct external dependency and policy use.** The committed lockfile records the
exact installed graph. A broad peer range is a consumer contract. It does not
count as installed version drift.

## Workspace boundary

`pnpm-workspace.yaml` defines the policy boundary. The root manifest is in scope.
Every package selected by its `packages` patterns is also in scope.

The external client fixture at
`libs/client/shell/test/external/fixture/package.json` is outside the workspace on
purpose. It models a clean consumer. It owns its dependency versions. Other
manifests outside the workspace patterns also own their versions. This policy can
name an exception.

The baseline at commit `08fc93b9b` contains 133 workspace manifests. It has 165
external dependency names.

## Dependency classes

| Class | Policy |
| --- | --- |
| Direct `dependencies` | Use the approved catalog entry for the package and consumer scope. |
| Direct `devDependencies` | Use the approved catalog entry. Toolchain pins follow the exact-version rules below. |
| Direct `optionalDependencies` | Use the catalog of the package that owns the optional companion. Use its family rule too. |
| `peerDependencies` | Treat the range as a consumer support contract. Do not compare it with the installed catalog version. |
| Local workspace packages | Use `workspace:*`. A different local range needs a public-package support reason. |
| File, link, Git, or URL sources | Keep them outside normal catalogs. Each use needs a narrow review exception. State the reason and removal condition. |
| Manifests outside the workspace | Keep their versions independent. External-consumer fixtures must not inherit workspace catalogs. |
| Transitive lockfile entries | Audit the committed lockfile. Do not rewrite a manifest only to remove a duplicate. Do not add an override for that reason alone. |

The current workspace has no direct external file, link, Git, or URL dependency.

## Checking direct dependencies

Run the direct-dependency check after changing a workspace manifest:

```sh
pnpm check:dependencies
```

The check reads committed manifests and the workspace catalog. It does not read
registry metadata.

Use the fix command to restore eligible direct dependencies to `catalog:`:

```sh
pnpm fix:dependencies
```

The fix does not update dependencies or format manifests. A non-semver source
needs a named exception in the repository policy configuration.

## Catalog and range rules

The default catalog holds the version intent. It covers eligible direct external
dependencies. Another catalog entry needs a named scope and a different range
shape. Examples include a peer support catalog and a temporary
legacy-major catalog.

Catalog names must describe the scope. Do not create `old`, `new`, or numbered
catalogs with no stated contract. A temporary catalog entry needs a tracking
issue and a removal condition.

### Caret ranges

Use a caret range by default.

- A caret range accepts compatible minor and patch releases. Use it by default.
- Use a tilde range only when the package must stay on one minor line. A reviewed
  prerelease line can also use a tilde.
- Keep the minimum version at the lowest tested version. Do not copy the current
  lockfile resolution into a published range.
- Do not use wildcards or open-ended ranges for direct non-peer dependencies.

The lockfile, not a narrow manifest range, makes application installs
reproducible.

### Exact versions

Exact pins need a clear reason. Use an exact version only in these cases.

- A generated or prebuilt artifact must run with the version that created it.
- A runtime family has one numeric version for all members. Its upstream release
  contract makes partial updates invalid.
- A package ships a platform-specific binary or companion from the same release.
- A formatter, compiler, or other development tool produces repository-owned
  output. That output must change only in an explicit update.

The policy entry and Renovate rule must state which condition applies. Exact pins
are not the default for published packages.

## Rules by consumer

### Applications and private packages

Applications and private packages use caret catalog ranges by default. The
committed lockfile pins deployments and local installs. An exact catalog entry
needs an artifact, protocol, or lockstep invariant. The list above defines those
cases.

### Development tooling

Pin generators, formatters, and compilers when their output is part of the
repository contract. Pin their platform companions too. General test helpers and
type-only utilities use caret ranges. An upstream limit can require a
narrower range.

### Published `libs/*` and `tools/*` packages

Published runtime dependencies use caret ranges by default. An exact runtime pin
needs proof. The Temporal prebuilt-bundle contract is one example.

Peer ranges state the versions that consumers can provide. Keep them broad
enough to match tested support. The workspace can install a newer version than
the peer minimum.

Packed manifests must contain ordinary npm semver specifications. They must not
contain `catalog:`. They must not contain an unresolved `workspace:` protocol.
An external npm consumer must be able to install them.

## Current direct mismatch dispositions

This table records every external dependency name with more than one direct
specification. The baseline commit is `08fc93b9b`. The audit checks
`dependencies`, `devDependencies`, `optionalDependencies`, and
`peerDependencies`. It reads all 133 workspace manifests.

| Dependency | Current specifications | Classification | Policy result |
| --- | --- | --- | --- |
| `@types/node` | `^24.1.0`, `25.9.3` | Unintended drift to align. | Align all declarations with the repository's Node 24 toolchain. Do not keep Node 25 types while `mise.toml` runs Node 24. |
| `tsx` | `^4.21.0`, `^4.22.4` | Unintended drift to align. | Use one caret range with `4.22.4` as the reviewed minimum. |
| `react` | direct `^19.1.1`, peer `^19.0.0` | Intentional peer compatibility. | Keep the peer minimum separate. Direct runtime entries follow the React family version. |
| `react-dom` | direct `^19.1.1`, peer `^19.0.0` | Intentional peer compatibility. | Keep the peer minimum separate. Direct runtime entries follow the React family version. |
| `zod` | `4.4.3`, `^4.1.11`, `^4.4.3` | Unintended drift to align. | Use the `^4.4.3` caret entry. The lockfile supplies the exact workspace install. |
| `@opentelemetry/api` | `1.9.1`, `^1.9.0` | Unintended drift to align. | Use the `^1.9.1` caret entry. No exact runtime contract exists here. |
| `fishery` | `^2.2.2`, `^2.4.0` | Unintended drift to align. | Use one caret range with `2.4.0` as the reviewed minimum. |
| `@temporalio/client` | `1.18.1`, `^1.16.1` | Temporary compatibility exception. | Move the full Temporal family in one migration. Use exact `1.18.1`. Remove the exception when packed-consumer and workflow-bundle checks pass. |
| `@temporalio/common` | `1.18.1`, `^1.16.1` | Temporary compatibility exception. | Move the full Temporal family in one migration. Use exact `1.18.1`. Remove the exception when packed-consumer and workflow-bundle checks pass. |
| `@temporalio/worker` | `1.18.1`, `^1.16.1` | Temporary compatibility exception. | Move the full Temporal family in one migration. Use exact `1.18.1`. Remove the exception when packed-consumer and workflow-bundle checks pass. |
| `ajv` | `8.20.0`, `^8.20.0` | Unintended drift to align. | Use the `^8.20.0` caret entry. |
| `fastify-plugin` | `^5.1.0`, `^6.0.0` | Deliberate multi-major migration. | Keep the v5 use narrow. The webhook package must pass its route and packed-package checks on v6. Use a separate pull request for the major migration. Remove the legacy entry there. |
| `@testing-library/react` | `^16.3.0`, `^16.3.2` | Unintended drift to align. | Use one caret range with `16.3.2` as the reviewed minimum. |

The catalog migration must apply these dispositions without changing unrelated
dependency versions. A later mismatch needs a policy update. An approved
exception is the only other path into the catalog.

## Coordinated Renovate families

Every family in this table updates in one Renovate pull request. `Complete
release` means Renovate waits until every listed member has an update. `Identical
version` means the numeric version must match across members. Peer ranges do not
take part in numeric equality.

| Family | Direct members | Complete release | Identical version | Range rule |
| --- | --- | --- | --- | --- |
| Biome distribution | `@biomejs/biome`, `@biomejs/cli-darwin-arm64`, `@biomejs/cli-darwin-x64`, `@biomejs/cli-linux-arm64`, `@biomejs/cli-linux-x64` | Yes. | Yes. | Exact. |
| Temporal SDK | `@temporalio/activity`, `@temporalio/client`, `@temporalio/common`, `@temporalio/interceptors-opentelemetry`, `@temporalio/testing`, `@temporalio/worker`, `@temporalio/workflow` | Yes. | Yes. | Exact. |
| React runtime | `react`, `react-dom` | Yes. | Yes. | Caret. Peers stay separate. |
| Vitest | `vitest`, `@vitest/browser-playwright` | Yes. | Yes. | Caret. |
| Storybook core | `storybook`, `@storybook/addon-vitest`, `@storybook/react`, `@storybook/react-vite` | Yes. | Yes. | Caret. |
| Tailwind CSS | `tailwindcss`, `@tailwindcss/vite` | Yes. | Yes. | Caret. |
| React type definitions | `@types/react`, `@types/react-dom` | No. | No. | Group only. |
| TanStack Query | `@tanstack/query-core`, `@tanstack/react-query`, `@tanstack/react-query-devtools` | No. | No. | Group only. |
| TanStack Router | `@tanstack/react-router`, `@tanstack/router-core`, `@tanstack/router-plugin` | No. | No. | Group only. |
| Argos CI | `@argos-ci/cli`, `@argos-ci/playwright`, `@argos-ci/storybook` | No. | No. | Group only. |
| Vite | `vite`, `@vitejs/plugin-react` | No. | No. | Group only. |

A complete-release family uses `minimumGroupSize` equal to the number of listed
members. A grouped-only family has no minimum. One available member cannot block
the rest forever.

A security update can bypass a complete-release wait. This is allowed when a
delay is riskier than a partial update. The pull request records the support
review. It also states how the family invariant will return.

A shared vendor scope does not create a family. OpenTelemetry packages use
several upstream release trains. Do not force that whole scope to one numeric
version.

## Transitive duplicate exceptions

Transitive duplicates need a reviewed baseline. The baseline must conform to
[`dependency-exceptions.schema.json`](dependency-exceptions.schema.json). Each
entry covers one exact package name. It also covers one exact observed version
set. Globs and semver ranges are not allowed.

| Field | Rule |
| --- | --- |
| `package` | Exact npm package name. |
| `allowedVersions` | Sorted set of exact normalized versions present in the lockfile. |
| `classification` | `temporary-compatibility`, `permanent-platform`, or `permanent-toolchain`. |
| `reason` | Why the versions must coexist. Name the incompatible ranges, platform boundary, or toolchain boundary. |
| `removalCondition` | A concrete event that makes the exception removable. Permanent entries still state when the platform or toolchain case ends. |
| `trackingIssue` | Must be set for a temporary compatibility exception. |
| `owner` | Must be set for a temporary compatibility exception. |
| `evidence` | Optional repository paths or stable links that support the reason. |

This example shows the format. It does not approve either package:

```json
{
  "$schema": "./docs/policies/dependency-exceptions.schema.json",
  "schemaVersion": 1,
  "transitiveExceptions": [
    {
      "package": "example-parser",
      "allowedVersions": ["2.4.0", "3.1.0"],
      "classification": "temporary-compatibility",
      "reason": "One upstream consumer still requires the 2.x parser API.",
      "removalCondition": "Remove 2.4.0 when the upstream consumer accepts parser 3.x.",
      "trackingIssue": "ENG-123",
      "owner": "engineering",
      "evidence": ["libs/example/package.json"]
    },
    {
      "package": "example-build-tool",
      "allowedVersions": ["4.2.0", "5.0.1"],
      "classification": "permanent-toolchain",
      "reason": "Two supported build targets require separate compiler lines.",
      "removalCondition": "Remove 4.2.0 when the older build target is dropped."
    }
  ]
}
```

The lockfile audit compares the exact version set. A new package fails until a
reviewer updates the exception. A new version or a larger set also fails.
Separate native package names are separate packages. They are not duplicate
versions of one package.

## Deterministic pull-request checks

Pull-request dependency-policy checks read committed repository files only. The
same commit must produce the same result without registry metadata.

These checks must not do any of the following.

- ask a registry which version is latest or newly available.
- run `pnpm dedupe --check` as a pull-request gate.
- accept a change because a package appeared after the pull request started.
- mutate manifests or the lockfile during validation.

Renovate can use registry state to propose an update. The proposed catalog is a
fixed input to the pull request. The same applies to manifests, configuration,
and the committed lockfile. A frozen install can fetch pinned artifacts. It must
not resolve a new version.

## Changing the policy

A policy change must include the reason. It must name the affected package
scopes and include a migration plan. A temporary exception needs an owner and
tracking issue. It also needs a removal condition. Remove an exception with the
extra version or legacy direct specification.
