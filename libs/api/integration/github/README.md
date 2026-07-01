# GitHub Integration

## GitHub App permissions (self-hosting)

Install the GitHub App with the smallest repository grant your workflows need:

- **Contents**: use **Read-only** unless a workflow requests `checkout.permissions.contents: write`; use **Read and write** only for repositories where jobs must push.
- **Metadata**: use **Read-only**. GitHub requires metadata access for installed apps.

Do not grant **Workflows**, **Pull requests**, **Administration**, **Secrets**, **Actions**, or **Members** for checkout credentials.

GitHub installation permissions are the ceiling for every per-job token. Shipfox can request a narrower repository-scoped token for a job, but GitHub rejects any requested permission outside the App installation grant. Withholding **Workflows** prevents a leaked checkout token from modifying CI definitions to reach Actions secrets.
