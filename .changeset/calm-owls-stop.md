---
'@shipfox/api-agent': minor
'@shipfox/api-server': minor
---

Adds turn admission, stop, retry, and a recovery sweep to agent conversations. A turn start checks the owner's membership and the workspace state, then the optional `admission.policy` of `createAgentModule`, and a workspace-state or policy denial writes a `turn_notice` instead of opening a turn. An owner who left the workspace gets no notice and no turn. `POST /conversations/:id/stop` stops a reply and keeps the partial message. `POST /conversations/:id/retry` runs a failed or denied turn again. The recovery sweep wakes conversations with queued inputs or a requested retry. `createAgentModule` now needs `workspaces` to run turns, and `defaultModules` passes it.
