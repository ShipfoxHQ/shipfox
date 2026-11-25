---
"@shipfox/react-ui": major
---

The public types no longer reference `framer-motion`, so a consumer that type-checks dependencies with `skipLibCheck: false` no longer loads framer-motion's declarations. Those declarations fail with `csstype` 3.2.4 and later, whose CSS `pathLength` property conflicts with framer-motion's `MotionStyle`.

- `Alert`, `TooltipContent`, and `TabsList` no longer accept a `transition` prop. Each component keeps its built-in animation.
- `alertDefaultTransition` and the tooltip `defaultTransition` are no longer exported.
- `TabsTriggerProps` extends the props of a `button` element instead of framer-motion's `HTMLMotionProps<'button'>`. `TabsTrigger` renders a plain `button`, so it no longer accepts motion props such as `whileHover`.
