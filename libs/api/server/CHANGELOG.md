# @shipfox/api-server

## 4.0.0

### Patch Changes

- Updated dependencies [5d129d6]
- Updated dependencies [67176d4]
- Updated dependencies [0b0a9c2]
- Updated dependencies [bbba3b7]
- Updated dependencies [1951293]
  - @shipfox/api-integration-core@4.0.0
  - @shipfox/api-auth@4.0.0
  - @shipfox/api-definitions@4.0.0
  - @shipfox/api-projects@4.0.0
  - @shipfox/api-workflows@4.0.0
  - @shipfox/annotations@4.0.0
  - @shipfox/api-logs@4.0.0
  - @shipfox/api-runners@4.0.0
  - @shipfox/api-agent@4.0.0
  - @shipfox/api-secrets@4.0.0
  - @shipfox/api-triggers@4.0.0
  - @shipfox/api-workspaces@4.0.0
  - @shipfox/node-module@0.3.1
  - @shipfox/api-dispatcher@4.0.0

## 3.0.0

### Minor Changes

- 3976f8c: Adds module login-method declarations, validates server compositions before startup, and adds password-login route configuration.

### Patch Changes

- Updated dependencies [3976f8c]
- Updated dependencies [7a71e7d]
- Updated dependencies [08fc93b]
  - @shipfox/node-module@0.3.0
  - @shipfox/api-auth@3.0.0
  - @shipfox/api-agent@3.0.0
  - @shipfox/api-definitions@3.0.0
  - @shipfox/api-dispatcher@3.0.0
  - @shipfox/api-integration-core@3.0.0
  - @shipfox/api-logs@3.0.0
  - @shipfox/api-projects@3.0.0
  - @shipfox/api-runners@3.0.0
  - @shipfox/api-triggers@3.0.0
  - @shipfox/api-workflows@3.0.0
  - @shipfox/node-opentelemetry@0.5.1
  - @shipfox/annotations@3.0.0
  - @shipfox/api-secrets@3.0.0
  - @shipfox/api-workspaces@3.0.0
  - @shipfox/node-fastify@0.2.2

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
