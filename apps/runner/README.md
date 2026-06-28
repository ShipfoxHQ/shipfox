# @shipfox/runner

Polls the Shipfox API for jobs and executes their steps on the runner host.

## Host prerequisites

- **`git`** must be installed on the runner host and on `PATH`. Each job is
  executed against a checkout of its project repository, so a runner without
  `git` cannot run repository-backed jobs.

## Workspace directories

The runner prepares a fresh working directory for every job, runs all of the
job's steps from it, and removes it afterwards. Steps do **not** inherit the
runner process's working directory.

During the synthetic "Set up job" step, the runner exchanges the job's lease for
short-lived, read-only checkout credentials and shallow-clones the project
repository into the per-job directory. The credentials are fetched only after the
job is claimed, are never persisted to disk or `.git/config`, and never appear in
logs or step errors. A setup failure (missing `git`, a denied credential, or an
unreachable provider) fails the job before any step runs, with a machine-readable
reason recorded on the step.

At startup, the runner exchanges `SHIPFOX_RUNNER_TOKEN` for a short-lived runner
session token using `SHIPFOX_RUNNER_LABELS`. Job polling uses that session token.
Heartbeat, step, checkout, and log calls use the per-job lease token returned by
the claim response.

The runner refuses to start when `SHIPFOX_RUNNER_LABELS` is empty after trimming.
When no job is claimed before `SHIPFOX_POLL_MAX_DURATION_MS`, it exits cleanly so
short-lived provisioned runners can be reclaimed. A session-exhausted response
also exits cleanly. If the API keeps erroring until the same deadline, the runner
exits nonzero so supervisors can see the outage. Manual or self-hosted runners
that should poll forever must set `SHIPFOX_POLL_MAX_DURATION_MS=0`.

### `SHIPFOX_RUNNER_WORKSPACE_ROOT` (optional)

Parent directory under which per-job working directories are created.

- **Unset (default):** per-job directories are created under the OS temp
  directory.
- **Set:** per-job directories are created under the configured path.

The runner only ever creates and cleans a per-job child directory under this
root; it never touches the root itself. The directory is pre-cleaned before use
(so a directory left by a previous crash is never reused) and removed after the
job completes, fails, or is cancelled.

The value is validated once at startup. The runner refuses to start when the
configured root is empty, the filesystem root (`/`), or a home directory.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `SHIPFOX_API_URL` | — | Base URL of the Shipfox API. |
| `SHIPFOX_RUNNER_TOKEN` | — | Registration token copied from the workspace runner settings. The runner exchanges it for a session token at startup. |
| `SHIPFOX_RUNNER_LABELS` | — | Comma-separated labels registered on this runner session, such as `linux,x64,self-hosted`. |
| `SHIPFOX_RUNNER_WORKSPACE_ROOT` | OS temp dir | Parent directory for per-job workspaces (see above). |
| `SHIPFOX_POLL_INTERVAL_MS` | `1000` | Base poll interval when requesting jobs. |
| `SHIPFOX_POLL_MAX_INTERVAL_MS` | `5000` | Maximum backoff interval when no jobs are available or the API errors. |
| `SHIPFOX_POLL_MAX_DURATION_MS` | `300000` | Maximum time to poll without claiming a job. Set to `0` to poll forever for manual or self-hosted runners. |
| `SHIPFOX_HEARTBEAT_INTERVAL_MS` | `10000` | Heartbeat tick interval for an in-flight job. |
| `SHIPFOX_HEARTBEAT_MAX_STALE_MS` | `10000` | Max time a single heartbeat may stay outstanding before it is aborted. |
| `ANTHROPIC_API_KEY` | none | Anthropic API key the embedded pi harness uses to run agent steps against Anthropic models. Read from the process environment. Unset or empty disables agent steps, which then fail at invocation; other step types are unaffected. |
| `SHIPFOX_LOG_FLUSH_INTERVAL_MS` | `2000` | How often buffered step logs are uploaded. Bounds how much recent output is lost if the runner dies mid-step. |
| `SHIPFOX_LOG_FLUSH_BYTES` | `262144` | Backlog size that triggers an early log upload before the interval elapses, so bursts do not wait for the timer. |
| `SHIPFOX_LOG_SPOOL_MAX_BYTES` | `67108864` | Max not-yet-acknowledged log bytes kept on disk per step attempt. Beyond this, output is dropped and a gap marker is recorded. |
| `SHIPFOX_LOG_DRAIN_TIMEOUT_MS` | `5000` | How long the runner waits at job end for in-flight log uploads before deleting the workspace. |
| `SHIPFOX_AGENT_SESSION_FLUSH_BYTES` | `4194304` | Upload window and per-entry drop threshold for agent-session logs. Entries over this encoded-record size are dropped with a gap marker instead of forwarded. |
