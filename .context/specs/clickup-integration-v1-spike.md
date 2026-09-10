# ClickUp integration v1 test-app spike

Status: **blocked on a ClickUp test app and test users**

Date checked: 2026-09-10

Issue: [ENG-2053](https://linear.app/shipfox/issue/ENG-2053/clickup-test-app-spike-grant-widening-token-reuse-state-round-trip)

## Executive result

The repository environment has no ClickUp OAuth app credentials, access token,
test workspace, or test users. No live ClickUp test-app or API request was run from this workspace. This note does not turn an unrun experiment into a vendor claim.

The published ClickUp documentation answers the webhook-pair question and
provides useful constraints for the other questions. It does not prove the
OAuth token behaviors that gate the connection boundary. The implementation
gate therefore remains **not approved**:

- ENG-2057 and ENG-2059 remain blocked on the live grant-widening experiment.
- `create_task` remains deferred until that experiment proves that the grant
  cannot reach another workspace without `GET /api/v2/team` revealing it.
- The session-open `/team` check remains the proposed guard, not an accepted
  isolation boundary.

This is the conservative amendment required by the spec. If the grant-widening
experiment shows hidden reach, v1 is a go/no-go decision. At minimum,
`create_task` stays out because a List response exposes Folder and Space
identity but no workspace id, so a List target cannot be preflighted.

## ClickUp app and auth model

### Evidence and test setup

The official pages used below are:

- [Authentication](https://developer.clickup.com/docs/authentication)
- [Get Authorized Workspaces](https://developer.clickup.com/reference/getauthorizedteams)
- [Webhooks](https://developer.clickup.com/docs/webhooks)
- [Task webhook payloads](https://developer.clickup.com/docs/webhooktaskpayloads)
- [Delete Webhook](https://developer.clickup.com/reference/deletewebhook)

The live test must use one OAuth app, two ClickUp users, two workspaces, and a
webhook receiver that records raw requests, response codes, and response
bodies. Tokens, client secrets, authorization codes, webhook secrets, and
personal data must be redacted in the saved trace.

The request sequence is:

1. Authorize user A for exactly one workspace, using a unique state value.
2. Exchange the code and save the redacted token response.
3. Call `GET /api/v2/team` with token A and save the complete response.
4. Authorize user A for a second workspace. Call `GET /api/v2/team` again
   with the original token. Use a task and a List known to belong only to the
   second workspace to test the old token's actual reach.
5. Complete a second authorization by user A. Compare the returned token with
   the first token. Call `GET /api/v2/team` and a known first-workspace endpoint
   with the old token after the second authorization.
6. Capture the browser redirect after an authorization containing `state`.
   Compare the exact callback query with the sent state.
7. Create a workspace webhook with user A's token. Delete its id with user B's
   token. Repeat the delete with user A's token only if the first delete does
   not remove it.
8. Create a private Space with a control task visible to user A but not user
   B, and a separate private Space with a hidden task visible to user B but not
   user A. Register a workspace webhook as user A. Change the control task as
   user A and record whether the receiver gets a delivery. Keep A's webhook in
   place, change the hidden task as authorized user B, and record whether the
   receiver gets a delivery. Keep the request and response for each mutation
   distinct so the control case remains separate from the hidden-task case.

The API requests used for the live portions are:

```http
GET https://api.clickup.com/api/v2/team
Authorization: Bearer <redacted>
Accept: application/json
```

```http
GET https://api.clickup.com/api/v2/task/<workspace-B-task-id>
Authorization: Bearer <token-A>
Accept: application/json
```

```http
GET https://api.clickup.com/api/v2/list/<workspace-B-list-id>
Authorization: Bearer <token-A>
Accept: application/json
```

```http
POST https://api.clickup.com/api/v2/team/<workspace-A-id>/webhook
Authorization: Bearer <token-A>
Content-Type: application/json

{"endpoint":"https://receiver.example/clickup","events":["taskUpdated"]}
```

```http
DELETE https://api.clickup.com/api/v2/webhook/<webhook-id-created-by-A>
Authorization: Bearer <token-B>
Accept: application/json
```

The live responses for these requests are **not available**. The test app and
tokens must be supplied before these requests can answer the unresolved gates.

### Answers in the requested order

#### 1. Can a one-workspace grant silently widen?

**Answer: not proven. Do not ship the connection boundary yet.**

The authentication page says that users can authorize one or more Workspaces
and that they can return to the authorization URL to modify Workspace
permissions. It does not say whether an existing token's reach changes after
that later authorization. The authorized-workspaces endpoint is the correct
observation point, but the vendor documentation does not prove that it
exposes every widening.

Published documentation request and response evidence:

```http
GET https://developer.clickup.com/docs/authentication
```

Response excerpt:

> Users can authorize one or more Workspaces. Use the Get Authorized Teams
> (Workspaces) endpoint to see which Workspaces are authorized. Redirect users
> to the authorization URL to modify Workspace permissions.

The required proof is the two `GET /api/v2/team` responses from the same
original token, before and after the later authorization, plus the response
from an id-addressed endpoint in the newly authorized workspace. Those
responses were not captured because no test app or token is configured here.

**Spec amendment:** treat the session-open check as an unapproved proposal.
Do not start the tools issue with `create_task`. If the original token can
read or write the second workspace while `/team` still returns only the first,
v1 is go/no-go. A List target cannot use a post-hoc fallback because its
response has Folder and Space identity but no workspace id.

#### 2. Does a second authorization reuse or invalidate the first token?

**Answer: not proven.**

The authentication page says that OAuth access tokens currently do not expire.
That does not answer whether a later authorization by the same user returns the
same token, rotates it, or invalidates the earlier token.

Published documentation request and response evidence:

```http
GET https://developer.clickup.com/docs/authentication
```

Response excerpt:

> The access token currently does not expire. This is subject to change.

That statement is about expiry, not token reuse or revocation. The required
proof is the token comparison and old-token call in the live sequence above.
No live response was captured. Until it is, reconnect behavior must not assume
that the old token remains usable or that a new token replaces it globally.

#### 3. Does `state` round-trip on the redirect?

**Answer: not proven.**

The authentication page explicitly permits a `state` query parameter in the
authorization URL. Its redirect description explicitly mentions returning the
authorization code, but does not state that `state` is returned.

Published documentation request and response evidence:

```http
GET https://developer.clickup.com/docs/authentication
```

Response excerpts:

> You can also add a `state` parameter:
> `https://app.clickup.com/api?client_id={client_id}&redirect_uri={redirect_uri}&state={state}`

> Users will be redirected back to the `redirect_uri` with the authorization
> code after logging in.

This is insufficient to claim either behavior. The required proof is the raw
redirect URL and query string from an authorization containing a unique state.
No live redirect was captured. If the state is absent, use a short-lived
server-side pending record keyed by the session user. Keep the callback route
user-authenticated and keep one configured `redirect_uri`; do not vary the
redirect path per install.

#### 4. Do each `task*Updated` and `taskUpdated` pair share a history item id?

**Answer: yes for the published samples; live confirmation of every event is
still recommended.**

ClickUp's published task payload page shows the following shared
`history_items[0].id` values. The response bodies are the proof, not an
assumption based only on the event names.

| Pair in the published response | Shared history item id |
| --- | --- |
| `taskCreated` and `taskStatusUpdated` | `2800763136717140857` |
| `taskPriorityUpdated` and `taskUpdated` | `2800773800802162647` |
| `taskStatusUpdated` and `taskUpdated` | `2800787326392370170` |
| `taskAssigneeUpdated` and `taskUpdated` | `2800789353868594308` |
| `taskDueDateUpdated` and `taskUpdated` | `2800792714143635886` |
| `taskTagUpdated` and `taskUpdated` | `2800797048554170804` |
| `taskMoved` and `taskUpdated` | `2800800851630274181` |
| `taskCommentPosted` and `taskUpdated` | `2800803631413624919` |
| `taskCommentUpdated` and `taskUpdated` | `2800803631413624919` |
| `taskTimeEstimateUpdated` and its published paired update sample | `2800808904123520175` |
| `taskTimeTrackedUpdated` and its published paired update sample | `2800809188061123931` |

Published documentation request and response evidence:

```http
GET https://developer.clickup.com/docs/webhooktaskpayloads
```

Response excerpt for the status pair:

```json
{
  "event": "taskStatusUpdated",
  "history_items": [{"id": "2800787326392370170", "field": "status"}]
}
```

The corresponding `taskUpdated` sample contains the same id:

```json
{
  "event": "taskUpdated",
  "history_items": [{"id": "2800787326392370170", "field": "status"}]
}
```

The page states the same relationship in prose for each listed specific task
update. The v1 delivery id must include the event name as well as the history
id, because paired deliveries otherwise collide:

```text
<webhook_id>:<event>:<history_items[0].id>
```

#### 5. Can another user delete a webhook created by the first user?

**Answer: not proven live; the documented model says the webhook belongs to its
creator.**

The Webhooks page says that webhooks are created with the user's auth token and
are tied to that user. It also says that a disabled creator leaves the webhook
present but stops it from triggering. That strongly indicates that a second
user's token must not be treated as an owner token, but it is not an API
response to the cross-user DELETE request.

Published documentation request and response evidence:

```http
GET https://developer.clickup.com/docs/webhooks
```

Response excerpt:

> Webhooks are created using the user's auth token and therefore are tied to
> the user.

The required live proof is:

```http
DELETE https://api.clickup.com/api/v2/webhook/<A-created-id>
Authorization: Bearer <token-B>
```

followed by the captured status and JSON body. That response was not captured.
Until it is, reconnect must use the old token for best-effort deletion before
replacing the stored token. The reconcile worker must not assume that the new
user can see or delete the old user's webhook.

#### 6. Do deliveries fire for tasks outside the creator's visibility?

**Answer: not established by published docs; the private-Space test is not run.**

The Webhooks page documents that ClickUp checks whether the creating user
remains in the relevant hierarchy before triggering each webhook. It also
discusses a disabled creator whose webhook remains but stops triggering. Those
statements address hierarchy membership and creator status, not whether a
creator who remains a hierarchy member receives deliveries for tasks outside
that creator's visibility. The private-Space behavior is therefore an
inference that requires a live test, not a documented vendor result. The v1
events contract must remain unsettled until that test is complete.

Published documentation request and response evidence:

```http
GET https://developer.clickup.com/docs/webhooks
```

Response excerpt:

> If the user who created a webhook is disabled, the webhook remains but stops
> triggering. The system checks if the user is still part of the relevant
> hierarchy before triggering each webhook.

The required live proof is a receiver trace for a request that authorized user
B makes to mutate a task in a private Space that webhook creator A cannot see.
Capture the mutation request, ClickUp response, and whether the receiver gets a
delivery. No such delivery trace was captured. Do not describe this as a
completed test-app result.

## Connection boundary for id-addressed tools

### Implementation consequences

The following remains the safe v1 boundary until the missing live responses are
recorded:

- Require exactly one workspace at connect time.
- Recheck `GET /api/v2/team` at every tool session open.
- Do not add post-hoc id ownership detection or an ownership cache as an
  unpromised fallback.
- Keep `create_task` deferred. A create call needs a List id, and the List
  response does not expose a workspace id that can be checked.
- If ClickUp does not echo `state`, use the user-keyed pending record fallback.
- Treat old-user webhook cleanup as best effort with the old token. The new
  token's webhook list is not evidence that the old webhook is gone.
- Preserve the event name in delivery ids even when paired deliveries share a
  history item id.

## Required follow-up capture

When ClickUp access is available, append the redacted raw traces below this
line rather than replacing the unresolved answers:

1. OAuth authorize URL and callback URL, including the state result.
2. Token exchange response for the first and second authorizations.
3. `GET /api/v2/team` with the original token before and after the later grant.
4. An id-addressed request into the later workspace made with the original
   token.
5. Cross-user webhook DELETE status and body.
6. Private-Space event receiver request, or an explicit absence after the
   task mutation and an observation window.

No access token, client secret, authorization code, webhook secret, or private
workspace identifier belongs in this repository note.
