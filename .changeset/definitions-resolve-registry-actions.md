---
"@shipfox/api-definitions-dto": minor
"@shipfox/api-definitions": minor
"@shipfox/api-workflows": patch
"@shipfox/api-server": patch
---

Definition sync and dev runs resolve registry actions, such as `uses: shipfox/slack-thread-digest@1.4.2`. Registry actions turn on when `DEFINITION_ACTIONS_ENABLED` is on and `REGISTRY_URL` is set. Definitions now read `REGISTRY_URL` too, to decide whether to accept registry references.

- **Resolution:** the Registry module returns a verified version, and the definitions module checks that the bundle's `action.yml` equals the signed manifest. Sync and dev runs store the bundle as a workspace action snapshot with the new `registry` source, so the runtime bundle route and the runner stay unchanged.
- **Limits:** the 20-action limit per workflow file counts repository and registry actions together. Registry bundles skip the repository size limits and the relative import check, because the registry bundles them. Uploads apply to `./` paths only.
- **Model:** action steps gain `origin` (`local` or `registry`), and registry steps also carry `package` and `version`. Models stored before this change omit `origin` and mean `local`. The step config sent to the runner carries the same fields.
- **Sync errors:** a missing version is `action-not-found`. A version that fails verification, an unsupported document format, or a bundle that differs from its signed manifest is `action-invalid`. Both appear as diagnostics on the workflow file that references the action. An unavailable registry fails the sync attempt and retries.
- **Dev runs:** a registry failure fails the run with an `invalid-definition` message that names the action.
