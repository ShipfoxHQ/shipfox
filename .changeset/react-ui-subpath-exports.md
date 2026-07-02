---
"@shipfox/react-ui": major
---

Replace the root barrel with per-component subpath exports. Import from a subpath
(`@shipfox/react-ui/button`, `@shipfox/react-ui/card`, ...), or from
`@shipfox/react-ui/hooks` / `@shipfox/react-ui/utils`, so importing one component
no longer evaluates the whole component tree (and its Radix and icon dependencies)
in the dev server or bundlers. The package is now `sideEffects`-free except for CSS
so bundlers can tree-shake it.

BREAKING: the root entry point `@shipfox/react-ui` no longer resolves. Replace
`import {Button} from '@shipfox/react-ui'` with `import {Button} from '@shipfox/react-ui/button'`.
