# @shipfox/runner-agent

## 0.0.1

### Patch Changes

- eb40964: Add an inline `agent` workflow step that the runner runs with the pi harness. A step is an agent step when it carries `model` + `prompt` and no `run`; it takes a free-text `model`, a single `prompt`, and an optional `thinking` level (default `high`). The step runs to process-success (the agent ran to completion) and reports through the existing step protocol with no runner/backend protocol change, so change quality is judged by a downstream `run` + `gate` step. v1 does not persist the agent's work (no diff, commit, or PR).
- b525dcd: Let an agent workflow step pick its pi provider with an optional free-text `provider` field (default `anthropic`), threaded to the runner's pi model lookup, and split agent-step failures into a user-fixable `agent_config_invalid` reason (unknown provider, missing runner credentials, wrong provider/model pair) versus `agent_invocation_failed` for genuine provider/API errors.
- d49ee4c: Forward agent step session entries into the logs module as opaque `agent_session` records: the runner tails the pi session file and forwards each verbatim entry over a shared log-stream sink, and the write path stores them with a configurable per-line size cap sized for inline base64 content.
- Updated dependencies [eb40964]
- Updated dependencies [5c18360]
- Updated dependencies [7a9943d]
- Updated dependencies [e47f8da]
- Updated dependencies [736249b]
- Updated dependencies [2bc5595]
- Updated dependencies [7b175f5]
- Updated dependencies [940696a]
- Updated dependencies [c7d8b39]
- Updated dependencies [f98c2be]
- Updated dependencies [e9396c9]
- Updated dependencies [6c80f00]
- Updated dependencies [b525dcd]
- Updated dependencies [78d0f7f]
- Updated dependencies [3afb7e3]
- Updated dependencies [c652a68]
- Updated dependencies [5af4907]
- Updated dependencies [c0a883c]
- Updated dependencies [d69b164]
- Updated dependencies [2fb3e87]
- Updated dependencies [ef1e917]
- Updated dependencies [2933c33]
- Updated dependencies [d0cd759]
- Updated dependencies [e699508]
- Updated dependencies [8ecc121]
  - @shipfox/api-workflows-dto@1.0.0
  - @shipfox/runner-execution@0.1.0
  - @shipfox/node-opentelemetry@0.4.2
