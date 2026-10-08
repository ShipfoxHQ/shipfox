---
"@shipfox/api-auth": major
"@shipfox/api-auth-dto": major
"@shipfox/client-shell": patch
---

Targets impersonation windows at a workspace and keeps the administrator's own identity. `POST /admin/auth/impersonation/windows` takes `workspace_id` instead of `target_user_id` and `required_workspace_id`. The window token's `sub` is the administrator and its only membership is the window's workspace with role `admin`; start, idempotent replay, and continuation mint it through one helper that re-checks the operator role and the workspace state. A suspended, deleted, or missing workspace returns `409 impersonation-workspace-not-active`, which replaces `impersonation-target-not-workspace-member` and `impersonationTargetNotWorkspaceMemberErrorSchema`. Window start and continue responses carry `workspace_id`. Window summaries carry a nullable `workspace_id`, and `target` is now nullable. The `impersonatorId` token claim may equal `sub`. A window opened before this change has no workspace and returns `impersonation-window-stopped` on continuation. The legacy `POST /:userId/impersonate` route is unchanged. The client shell treats `impersonation-workspace-not-active` as a terminal continuation error.
