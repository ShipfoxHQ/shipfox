# Integration contracts

Contract cases for the integration tools, run against sandbox accounts and the E2E fakes.

## What it holds

- **`<provider>/<case>.yaml`**: one contract case. It becomes one job in the provider's workflow. The file name becomes the job key, so an alert names the tool.
- **`sandbox.yaml`**: the sandbox accounts, per provider. It holds the integration connection slug, the `fixtures` that exist, and the `targets` that must fail.
- **`backlog.yaml`**: the tools that have no case yet, and the `ceiling` it can't pass.
- **`<provider>/all.yaml`**: an exemption for a whole provider, with its reason.

The tool catalog drives coverage. Every tool needs a case, an exemption, or a backlog entry. The coverage test fails otherwise.

## Sandbox accounts

Each provider has its own sandbox tenant. Cases never read or write in company accounts, because the fixture ids in `sandbox.yaml` and the generated files are public.

| Provider | Tenant | Read fixtures | Write container |
| --- | --- | --- | --- |
| GitHub | A sandbox organization with the staging GitHub App installed | A repository with issues, pull requests, review threads, labels, and Actions runs | The same repository, on `contract/*` branches |
| Linear | A sandbox workspace | A read team with issues, comments, a project, and documents | A write team |
| Slack | A sandbox workspace | A read channel with a fixed message and thread | A write channel |
| ClickUp | A sandbox workspace | A list with tasks and comments | A write list |
| Notion | A sandbox workspace | A page, a data source, and comments | A write parent page |
| Jira | A free Atlassian Cloud site | A project with issues, comments, and transitions | A write project |
| Sentry | A sandbox organization with the staging Sentry App | A project with an issue that a daily workflow keeps alive | None |
| Discord | A sandbox server with the staging bot | A read channel with messages and a thread | A write channel |
| PostHog | The staging PostHog project | Events, insights, dashboards, and flags | None |

Read fixtures hold large and odd data. Examples: more than one page of results, markdown with non-ASCII text, a long body, and closed or archived objects.

### Set up a sandbox

1. Create the tenant and its fixtures. Keep them read-only for cases.
2. Connect the tenant in the staging workspace through the normal product flow. Give the integration connection the `connection` slug of its provider in `sandbox.yaml`.
3. Record the fixture ids in `sandbox.yaml`.
4. Give each fixture a `read`: the call that proves the object still exists. The `fixtures` job of the provider's workflow runs it.

A provider account links to one integration connection per Shipfox instance. The sandbox connections live next to the company connections in the staging workspace for that reason.

## Write a case

A case names a catalog tool, its input, and what the result must hold:

```yaml
provider: linear
modes: [real]
steps:
  - tool: get_issue
    with:
      id: $fixture.linear.issue.identifier
    expect:
      shape: {id: string, title: string}
      values: {id: $fixture.linear.issue.identifier}
```

- **`shape`** names fields and types. Extra fields are allowed. A list result checks its first item.
- **`values`** pins exact values for known fixtures. A closed catalog `outputSchema` gets value checks only, through `VALUES_ONLY_TOOLS` in the generator.
- **`matches`** gives a regular expression for a text value. Use it when the layout of the text is not part of the contract, such as the SQL results of PostHog.
- **`text`** lists regular expressions for a result that is itself text, not a map. PostHog returns most reads as TOON text. Each expression must match somewhere in the result.
- **`modes`** lists `real`, `fake`, or both. List `fake` only when the E2E fake answers the tool with the same fields. The pending list reports the cases that lack it.

Remove the case's backlog entry in the same change, and lower `ceiling` to the new entry count.

## Write an error case

An error case has `kind: error` and one step with `expect.error`. It reads its object from `$target`, never from `$fixture`, and fails when the call succeeds:

```yaml
provider: linear
kind: error
modes: [real]
steps:
  - tool: get_issue
    with:
      id: $target.linear.missing_issue.identifier
    expect:
      error: not-found
```

Run the case once against the real provider and write the code the step reports. Providers do not agree on codes: a missing GitHub repository is `provider-rejected`, a missing ClickUp task or Notion page is `access-denied`, and Slack and PostHog answer `unknown`. A case with an input the provider rejects needs no target.

## Generate the workflows

The generator writes `.shipfox-staging/workflows/` at the repository root. The staging instance syncs that path. Never edit those files by hand.

```sh
mise exec -- pnpm --filter @shipfox/e2e-eval-workflows build
mise exec -- pnpm --filter @shipfox/e2e-eval-workflows contracts:generate
```

A test fails when the committed files differ from the generator output.

## Check the cases

```sh
# Every generated file compiles against this branch's catalog.
mise run evals -- --suite contracts --mode compile

# The cases that list `fake` pass against the E2E fakes.
mise run evals -- --suite contracts

# The coverage and drift tests.
turbo test --filter=@shipfox/e2e-eval-workflows
```

One invalid file fails the whole staging sync, so run the compile check before you push.

## Run against the sandboxes

Start `contracts-<provider>.yaml` manually in the staging workspace. A dev run runs the file from your branch before it reaches `main`. `contracts.yaml` starts every provider file each night at 03:00 UTC.

A failed run names the job. The job key is the case file name, such as `get_issue`. When the `fixtures` job fails in the same run, a sandbox fixture is broken, not a tool.
