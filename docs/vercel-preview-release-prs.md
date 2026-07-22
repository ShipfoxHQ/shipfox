# Vercel release PR previews

Vercel previews are disabled for the generated `changeset-release/main` branch.
The configuration lives beside each deployed project so it is versioned and
reviewed with its build settings.

## Configuration source of truth

- `apps/docs/vercel.json`
- `libs/client/agent/vercel.json`
- `libs/client/auth/vercel.json`
- `libs/client/integrations/vercel.json`
- `libs/client/logs/vercel.json`
- `libs/client/runners/vercel.json`
- `libs/client/secrets/vercel.json`
- `libs/client/triggers/vercel.json`
- `libs/client/workflows/vercel.json`
- `libs/shared/react/ui/vercel.json`

Each file sets `git.deploymentEnabled["changeset-release/main"]` to `false`.
Vercel therefore does not create a preview deployment for that branch. Other
branches remain enabled by default, including the production `main` branch.

## Connected-project inventory

The generated release PR [#938](https://github.com/ShipfoxHQ/shipfox/pull/938)
currently reports Vercel statuses for these connected projects:

- `client-agent`
- `client-integrations`
- `client-logs`
- `client-runners`
- `client-triggers`
- `client-workflows`
- `docs`
- `react-ui`

The matching configuration files are included in the source-of-truth list
above. `client-auth` and `client-secrets` also keep the branch rule in their
repository configuration so a later Vercel connection cannot reintroduce
release-PR previews.

## Verification and rollback

After this change is merged, open or update a generated package release PR and
confirm there are no Vercel GitHub statuses or queued builds. Then open a normal
source PR that affects one of the projects above and confirm it receives the
usual preview. Confirm a commit to `main` still creates the usual production
deployment.

To roll back, remove the `changeset-release/main` entry from every listed
`vercel.json` file and merge the change. Use Vercel's Deployments page to
redeploy a skipped commit if a preview is required after the fact.
