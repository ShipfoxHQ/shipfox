# @shipfox/policy-notice

## 0.1.0

### Minor Changes

- 507915a: A required action can carry an optional `intent`, and `REQUIRED_ACTION_INTENTS` lists the known values. `intent` names a behavior a composing application may provide in place of opening `url`, such as `contact-support`. `url` stays required as the fallback, and an unknown `intent` still parses.

  The admission denial contract, the HTTP 409 `required_action`, and the agent-access error details now keep `intent` when it is set.

- a429987: Adds the shared policy notice contract and preserves the workflow admission type export.
