# @shipfox/application-release

## 0.1.1

### Patch Changes

- 9038afb: Productionizes published package manifests so external consumers resolve compiled dist output.
- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- a0c7d49: Adds packed-consumer guards for development resolution and Temporal workflow bundling.

## 0.1.0

### Minor Changes

- a3d684c: Adds a versioned application release manifest tool that verifies the complete OCI image set before publication.
- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.
