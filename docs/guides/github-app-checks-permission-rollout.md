# GitHub App Checks permission rollout

This runbook rolls out repository Checks write access for the live Shipfox
GitHub App. Use it after the permission-approval invalidation change is
running in production and before any general-availability announcement.

The runbook covers the GitHub App setting, installation-owner communication,
internal proof, and Linear evidence. It does not change provider code or
approve permissions for an external installation.

## Preconditions

Do not update the live App registration until every precondition has an owner
and evidence.

| Precondition | Required evidence |
| --- | --- |
| Permission invalidation is deployed | [ENG-2002](https://linear.app/shipfox/issue/ENG-2002/invalidate-github-installation-tokens-after-permission-approval) is implemented and its merged [PR #1705](https://github.com/ShipfoxHQ/shipfox/pull/1705) is known. Record the production deployment identifier and time separately. A merge is not deployment evidence. |
| The live App has an operational owner | Record the App administrator's name, GitHub handle, team, and backup on [ENG-2005](https://linear.app/shipfox/issue/ENG-2005/request-github-app-checks-permission). Noé Charmet is the rollout coordinator for this issue. Confirm that the coordinator or a named delegate can edit the live App registration. |
| An internal installation is selected | Use the live ShipfoxHQ organization installation that covers `ShipfoxHQ/shipfox`, unless the App administrator selects another internal test repository. Confirm the installation and repository scope before testing. |
| Check-run behavior is deployed | The [ENG-2007](https://linear.app/shipfox/issue/ENG-2007/verify-and-release-github-check-run-tools) issue supplies the check-run smoke invocation and its deployed release. Confirm that both are available and that the deployed environment can make a `check_run_write` call. Block the rollout until that release is available. |
| The rollout window is staffed | Record the rollout window, the Shipfox on-call, and the GitHub App administrator. Pause if either owner is unavailable. |

The repository contains the permission invalidation implementation, but it does
not own the live GitHub App registration. The App administrator must perform
the external setting change.

## Update the live App registration

1. Open the live App in GitHub under **Settings → Developer settings → GitHub
   Apps**.
2. Open **Permissions & events**.
3. Under **Repository permissions**, set **Checks** to **Read and write**.
4. Do not change repository selection, account permissions, webhook
   subscriptions, callback URLs, keys, or secrets during this change.
5. Save the setting and record the App slug, actor, UTC timestamp, exact
   permission, and a link to the App settings page on ENG-2005.

GitHub sends an updated-permission prompt to owners of personal accounts and
organizations where the App is installed. Existing installations keep their
current permissions until an owner accepts the update. See GitHub's guide to
[approving updated permissions for a GitHub App](https://docs.github.com/en/apps/using-github-apps/approving-updated-permissions-for-a-github-app).

Do not accept the prompt for an external installation. The installation owner
must make that decision.

## Send the installation-owner message

Send this message before or with the GitHub prompt. Replace only the bracketed
values.

> Shipfox is requesting one additional GitHub App repository permission:
> **Checks: Read and write**. This lets Shipfox workflows create and update
> check runs on the repositories already selected for the installation. It does
> not add repositories or change the existing repository selection.
>
> GitHub will show an updated-permission prompt for **[account or
> organization]**. Open the GitHub notification or email, review the updated
> repository permissions, and choose the option to approve the update. Until
> approval, check-run steps fail before GitHub creates a check.
>
> If you did not expect this request, do not approve it. Contact **[rollout
> owner]** instead. Reply with the installation account and approval time.
> Never send tokens, private keys, webhook signatures, or repository secrets.

Keep the message limited to the requested Checks permission. Do not describe
this rollout as a general-availability announcement.

## Prove the unapproved path

Run this step against the selected internal installation while its owner has
not accepted the GitHub prompt.

1. Use the deployed check-run smoke path to make one create call for a safe
   commit in the selected internal repository. The selected permission profile
   must request exactly `checks:write`.
2. Confirm that token minting fails with the public reason
   `provider-rejected` and upstream status `422`.
3. Confirm that no GitHub check-run route is called and no check is created.
4. Repeat the call immediately. Confirm that the scoped terminal backoff
   returns the same rejection without another token-mint request.
5. Record the result on ENG-2005 without recording a token or authorization
   header.

The expected operational signals are:

- `github_installation_token_mint` records a failed mint.
- The `github_installation_token_mint` failure count does not increase across the immediate repeat.
- `github_installation_token_backoff` records reason `provider-rejected`,
  class `terminal`, and profile `scoped`.
- `github_installation_token_lookup` records `backoff` for the immediate
  repeat.
- The log message `github installation token mint failed; backoff recorded`
  includes the installation and permission-profile context.
- The terminal backoff is 15 minutes. This duration is a fallback behavior,
  not a substitute for approval-event invalidation.

Record only bounded identifiers and outcomes. Use the installation account,
repository, connection slug, call method, UTC timestamps, error reason, status,
metrics, and a redacted log or dashboard link.

## Approve the internal installation

The owner of the selected internal installation must approve the prompt in
GitHub. The rollout coordinator must not approve it on the owner's behalf.

After approval:

1. Observe a GitHub webhook with event name
   `installation.new_permissions_accepted` for the selected installation.
2. Record the event time, installation account, and a redacted delivery
   reference. The event must be associated with the same installation used in
   the failed proof.
3. Confirm that webhook processing requests deletion of the installation token
   namespace. The namespace has this form:
   `system/github/installation-token/<installation-id>`.
4. Confirm from the secret-store audit record that the namespace deletion
   removed the cached token envelope and the permission-profile backoff. Do
   not copy any namespace values, token values, or secret-store payloads into
   Linear.
5. If cleanup fails, stop the rollout. Webhook retry safety will retry the
   cleanup after the delivery transaction is retried. Do not bypass the
   backoff manually.

The approval event must be observed before the post-approval call. A GitHub
permission change without the Shipfox event is not sufficient evidence that
cached rejection state was cleared.

## Prove immediate remint

Run the same check-run call immediately after the event and cleanup evidence.
Do not wait for the 15-minute terminal backoff to expire.

The expected results are:

- The call attempts a fresh installation-token mint for the `checks:write`
  profile.
- `github_installation_token_mint` records a successful mint.
- `github_installation_token_lookup` records `minted`, not `backoff`.
- The check-run request reaches GitHub and uses the selected repository and
  test commit.
- The call returns the expected check-run result, without exposing the token.

Record the elapsed time from the approval event to the fresh mint. If the call
still returns the terminal backoff, stop and investigate the event delivery,
installation identifier, namespace deletion, and deployment version. Do not
mark the proof successful because the backoff eventually expires.

## Record evidence on ENG-2005

Add one issue comment using this structure. Replace bracketed values and link
to redacted dashboards or audit records only.

```md
## Checks permission rollout evidence

- App registration: Checks = Read and write
- Registration actor: [name]
- Registration time (UTC): [timestamp]
- Operational owner: [name and team]
- Internal installation: [account and repository]
- Integration connection slug: [slug]
- Production deployment: [release or build identifier and time]
- Permission invalidation prerequisite: [ENG-2002 deployment evidence]

### Before approval

- Call time (UTC): [timestamp]
- Method: [check-run method]
- Permission profile: checks:write
- Result: provider-rejected
- Upstream status: 422
- Check-run route called: no
- Terminal backoff observed: yes
- Immediate retry observed backoff without mint: yes
- Mint failure count unchanged on immediate retry: yes
- Evidence: [redacted link]

### Approval event

- Event: installation.new_permissions_accepted
- Event time (UTC): [timestamp]
- Delivery reference: [redacted reference]
- Namespace cleanup confirmed: yes
- Permission-profile backoff cleared: yes
- Evidence: [redacted link]

### After approval

- Call time (UTC): [timestamp]
- Fresh mint observed: yes
- Waited for terminal backoff: no
- Check-run request reached GitHub: yes
- Test commit: [non-sensitive commit identifier]
- Evidence: [redacted link]
```

Do not add GitHub App private keys, client secrets, installation tokens, JWTs,
webhook signatures, `Authorization` headers, or repository secrets to the issue.
A screenshot is acceptable only after those values are removed.

## Stop conditions

Stop the rollout and leave the issue in progress when:

- the permission invalidation deployment cannot be proven;
- the live App administrator or internal installation owner is unknown;
- the pre-approval call does not return `provider-rejected` with upstream
  `422`;
- the ENG-2007 check-run smoke invocation or its deployed release is unavailable;
- check-run write behavior is not deployed;
- the pre-approval call reaches a GitHub check-run route;
- the approval event is missing or names another installation;
- namespace cleanup or permission-profile backoff clearing cannot be proven;
- the post-approval call waits for or returns the old terminal backoff;
- the exact log warning `github installation token backoff write failed` is
  observed; or
- an external installation would need approval from a Shipfox operator.

Do not announce general availability from this runbook. Continue the rollout
through [ENG-2007](https://linear.app/shipfox/issue/ENG-2007/verify-and-release-github-check-run-tools)
once its separate smoke-test and monitoring criteria are complete.

## References

- [GitHub: Approving updated permissions for a GitHub App](https://docs.github.com/en/apps/using-github-apps/approving-updated-permissions-for-a-github-app)
- [GitHub: Best practices for creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app#allow-time-for-users-to-accept-new-permissions)
- [GitHub check-run tools system design](https://linear.app/shipfox/document/github-check-run-tools-system-design-c6ca2ca23638)
- [Webhook retry safety](../architecture/webhook-retry-safety.md)
