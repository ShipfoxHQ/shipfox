# Changelog

## 3.0.1

### Patch Changes

- ffc7fc9: Republishes the affected release set after recovering package publication.
- Updated dependencies [ffc7fc9]
  - @shipfox/client-config@3.0.1
  - @shipfox/react-ui@0.3.5

## 3.0.0

### Minor Changes

- 5b06cd5: Adds a Vite manifest plugin that ships canonical Shipfox application identity assets and tags.

### Patch Changes

- d735fe3: Moves external package verification into package-owned Turbo tasks and stages production manifests outside the workspace.
- Updated dependencies [cb58afe]
  - @shipfox/react-ui@0.3.4
  - @shipfox/client-config@3.0.0

## 2.0.0

### Patch Changes

- 7ac43a4: Consolidates packed-consumer validation around stable publication and composition contracts instead of package-state snapshots.
- Updated dependencies [e6eba5b]
- Updated dependencies [ba2e3dc]
- Updated dependencies [1820feb]
- Updated dependencies [1b79cda]
- Updated dependencies [c2db8c3]
- Updated dependencies [112c0fa]
- Updated dependencies [326f4c0]
- Updated dependencies [4a91956]
  - @shipfox/api-auth-dto@6.0.0
  - @shipfox/react-ui@0.3.3
  - @shipfox/api-workspaces-dto@6.0.0
  - @shipfox/client-config@2.0.0

## 1.0.0

### Patch Changes

- 47809a2: Hardens packed client composition validation against release artifacts, undeclared route packages, and optional Storybook testing peers.
- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.
- 5c63a2a: Validates the published default client composition from a clean external Vite consumer and fixes typed access to the events settings route.
- d8658ba: Prevents composition builds from reading resolver IDs that include Vite version queries.
- Updated dependencies [bb037af]
  - @shipfox/api-auth-dto@5.0.0
  - @shipfox/api-workspaces-dto@5.0.0
  - @shipfox/client-api@1.0.0
  - @shipfox/client-config@1.0.0
  - @shipfox/react-ui@0.3.2

## 0.2.0

### Minor Changes

- 3d064b8: Publishes the client runtime closure with shell, feature, route, Vite, and testing contracts.
- 6bc2e45: Adds the composable upstream client shell, feature catalog, and route manifests for every client feature.

### Patch Changes

- Updated dependencies [3d064b8]
  - @shipfox/client-api@0.2.0
  - @shipfox/client-config@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [c18d624]
  - @shipfox/react-ui@0.3.1
  - @shipfox/client-config@0.0.2

## 0.0.1

- Add the private candidate client composition shell.
