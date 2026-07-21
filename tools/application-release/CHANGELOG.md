# @shipfox/application-release

## 0.1.3

### Patch Changes

- 88156ba: Verifies packed API runner composition with an installation provisioning policy.
- d735fe3: Moves external package verification into package-owned Turbo tasks and stages production manifests outside the workspace.

## 0.1.2

### Patch Changes

- 7ac43a4: Consolidates packed-consumer validation around stable publication and composition contracts instead of package-state snapshots.
- a777dac: Serializes packed runtime manifests to prevent concurrent productionization races.
- 4a91956: Publishes a shared provider-neutral `emailSchema` in `@shipfox/api-common-dto` and adopts it across auth and workspace invitation inputs. Adds a read-only `findUserByEmail`/`EmailOwner` seam to `@shipfox/api-auth` for looking up the current owner of a normalized email without creating a session or mutating that user. Extends the packed external consumer gate to exercise both seams against PostgreSQL through installed tarballs.
- 81f9544: Adds the registered in-memory inter-module transport: browser-safe contract primitives in `@shipfox/inter-module` (`defineInterModuleContract`, `defineInterModulePresentation`, known-error branding) and `@shipfox/node-module/inter-module` (`createInMemoryInterModuleTransport`, module integration, and a framework-neutral fake-presentation test harness). Extends the packed external-consumer check to cover the new package.

## 0.1.1

### Patch Changes

- 9038afb: Productionizes published package manifests so external consumers resolve compiled dist output.
- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- a0c7d49: Adds packed-consumer guards for development resolution and Temporal workflow bundling.

## 0.1.0

### Minor Changes

- a3d684c: Adds a versioned application release manifest tool that verifies the complete OCI image set before publication.
- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.
