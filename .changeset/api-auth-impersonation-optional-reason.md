---
"@shipfox/api-auth": major
"@shipfox/api-auth-dto": major
"@shipfox/api-common-dto": major
---

Makes the impersonation window reason optional. A window starts without a reason, and an owner can stop another administrator's window without one. The legacy `POST /:userId/impersonate` route still requires a reason. A reason that a client still sends is stored. The `reason` field is nullable on window responses and administration action events, so consumers must handle `null`. Removes the `impersonation-stop-reason-required` error code, `impersonationStopReasonRequiredErrorSchema`, and `ImpersonationStopReasonRequiredError`. Reasons on role grant, role revoke, and suspension are unchanged. Windows created before this change keep their reason.
