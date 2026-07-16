# @shipfox/api-server

## 2.0.0

### Minor Changes

- 7fc3ab5: Adds a startup-failure hook so applications can report errors before server cleanup closes monitoring.
- 521e006: Adds the @shipfox/api-server package with server lifecycle, default module composition, and an
  instrumentation preload entry, and exposes shutdownServiceMetrics from @shipfox/node-opentelemetry.

### Patch Changes

- Updated dependencies [0cd6dd4]
- Updated dependencies [c31a7e0]
- Updated dependencies [1b0d344]
- Updated dependencies [521e006]
  - @shipfox/node-module@0.2.0
  - @shipfox/api-integration-core@2.0.0
  - @shipfox/api-auth@2.0.0
  - @shipfox/api-workspaces@2.0.0
  - @shipfox/annotations@2.0.0
  - @shipfox/api-agent@2.0.0
  - @shipfox/api-definitions@2.0.0
  - @shipfox/api-dispatcher@2.0.0
  - @shipfox/api-logs@2.0.0
  - @shipfox/api-projects@2.0.0
  - @shipfox/api-runners@2.0.0
  - @shipfox/api-secrets@2.0.0
  - @shipfox/api-triggers@2.0.0
  - @shipfox/api-workflows@2.0.0
  - @shipfox/config@1.2.1
  - @shipfox/node-error-monitoring@0.1.2
  - @shipfox/node-fastify@0.2.1
  - @shipfox/node-opentelemetry@0.5.0
  - @shipfox/node-postgres@0.4.1
