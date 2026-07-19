# External composition findings

The graduated fixture uses the production `@shipfox/client-features` default composition and the
complete recursive client runtime closure from `publication-closure.json`. The external feature is
application-local, so route implementations and generated types cross the same package boundary as
a downstream distribution.

## Contract proof

The fixture proves that:

- every default feature contributes its production routes to the generated application module;
- an application-local settings route is added and the default login route is explicitly replaced;
- two application-local providers receive the shell query client and Jotai store, then nest in
  declaration order;
- application navigation and settings data render through the shell-owned registries;
- the external config fragment is required, merged, and readable by both providers and the route;
- the generated router types an application-local `Link` and `useParams` call; and
- the unapproved login collision fails with the exact normative diagnostic.

## Distribution isolation

Packed mode builds declarations and runtime files before creating tarballs. It installs every
first-party package through `file:` overrides in a temporary consumer outside the workspace, rejects
registry-resolved Shipfox packages, rejects `workspace:` ranges, and confirms runtime imports resolve
through each package's default `dist` condition. Linked mode keeps the same behavior and type checks
for faster local iteration.

## Collision diagnostic

The rejected build must return this diagnostic and a non-zero status:

```text
Route "/auth/login" is contributed by both features "shipfox.auth" and "fixture.unapproved-collision". Set override: true to replace it explicitly.
```
