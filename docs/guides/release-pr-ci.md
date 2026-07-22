# Generated release PR CI

Changesets-generated release PRs use the fast CI path only when the repository-owned verifier reproduces their complete tree from the PR base revision. The release App identity and branch name narrow the candidate set; the regenerated tree comparison is the security boundary.

The fast path keeps the required `Static verification`, `Unit and story tests`, `E2E tests`, and `Build images` contexts successful. It runs frozen dependency installation, package-release policy checks and tests, and the complete publication-closure preflight. The unit/story suite, E2E suite, and application image matrix are intentionally skipped.

Any verification error, timeout, malformed result, source edit, or other mismatch fails closed to the normal CI path.

To force full CI for every PR temporarily, set the repository Actions variable `FORCE_FULL_CI` to `true`.
