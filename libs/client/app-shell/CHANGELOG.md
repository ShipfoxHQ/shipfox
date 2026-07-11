# @shipfox/client-app-shell

## 0.0.3

### Patch Changes

- 8037501: Fix the missing focus ring on the nav bar's "Shipfox home" logo link. It stripped
  the outline but pointed at a non-existent `shadow-button-secondary-focus` token, so
  keyboard focus was invisible; it now uses the valid `shadow-button-neutral-focus`.
- 63bcac8: Moves workspace setup gating into route hooks so VCS onboarding and first project creation resolve before protected workspace content renders.
- a7da648: Fixes invisible keyboard focus rings on the user menu, integration tiles, and project cards by using the existing neutral button focus token.
- Updated dependencies [43d7996]
- Updated dependencies [14e0bea]
- Updated dependencies [9018f0b]
- Updated dependencies [7fdfd72]
- Updated dependencies [974b501]
- Updated dependencies [2a3193f]
- Updated dependencies [f104ff2]
- Updated dependencies [8037501]
- Updated dependencies [7341569]
- Updated dependencies [e4c6abf]
- Updated dependencies [a35c2dc]
- Updated dependencies [58f7aef]
- Updated dependencies [5264a22]
- Updated dependencies [9674879]
- Updated dependencies [225c9a5]
- Updated dependencies [42443b4]
- Updated dependencies [24f131b]
- Updated dependencies [7790355]
- Updated dependencies [bb2a7bc]
- Updated dependencies [63bcac8]
- Updated dependencies [5eb06d0]
- Updated dependencies [4e13e5f]
- Updated dependencies [e92150d]
- Updated dependencies [8037501]
- Updated dependencies [0fb6018]
- Updated dependencies [c27a1ed]
- Updated dependencies [b8e49ff]
- Updated dependencies [8037501]
- Updated dependencies [6c0da64]
- Updated dependencies [07f8ff8]
- Updated dependencies [e457582]
- Updated dependencies [8b5c905]
- Updated dependencies [f849131]
- Updated dependencies [a7da648]
- Updated dependencies [94bdcc5]
- Updated dependencies [a34c8ea]
- Updated dependencies [27770eb]
- Updated dependencies [8ac4bf4]
- Updated dependencies [3a0be6b]
- Updated dependencies [d42baf4]
- Updated dependencies [8037501]
- Updated dependencies [54bb8a3]
- Updated dependencies [f711e18]
- Updated dependencies [8ecc121]
  - @shipfox/react-ui@0.3.0
  - @shipfox/client-projects@0.0.3
  - @shipfox/client-auth@0.0.3

## 0.0.2

### Patch Changes

- Updated dependencies [5c1e777]
  - @shipfox/react-ui@0.2.0
  - @shipfox/client-auth@0.0.2
  - @shipfox/client-projects@0.0.2

## 0.0.1

### Patch Changes

- Updated dependencies [2311e15]
  - @shipfox/react-ui@0.1.1
  - @shipfox/client-auth@0.0.1
  - @shipfox/client-projects@0.0.1
