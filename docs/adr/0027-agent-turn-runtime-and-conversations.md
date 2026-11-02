# ADR 0027: Agent turn runtime and conversations

- **Status:** Accepted.
- **Date:** 2026-11-02.
- **Decision owners:** Server architecture and agents.
- **Linear issue:** [ENG-3137](https://linear.app/shipfox/issue/ENG-3137/run-agent-turns-on-temporal-with-server-side-model-calls).
- **Related:** [ADR 0002: Server inter-module architecture](0002-api-inter-module-architecture.md),
  [ADR 0004: Shared semantic packages and server dependency boundaries](0004-shared-semantic-packages-and-server-dependency-boundaries.md),
  [ADR 0006: Database ownership boundaries](0006-database-ownership-boundaries.md),
  [ADR 0015: Usage context and application seams](0015-usage-context-and-application-seams.md).

## Context

**Every model call so far ran on a runner.** A workflow agent step starts pi in a sandbox, and
the API only mints credentials and stores the transcript. A project agent answers a user in
seconds, waits for results for days, and has no sandbox to run in. The API process has to run
inference for the first time.

**The loop has to survive a deploy.** A turn makes several model calls and tool calls. A worker
that stops between two of them must lose nothing and repeat nothing that was stored.

**The prompt is a contract with the provider.** Providers cache by exact prefix. Current Claude
models bind each thinking signature to the system prompt, tools, and earlier messages. A prompt
rebuilt differently between two calls loses the cache, drops thinking, or returns a 400.

## Decision

### A conversation is a pi session stored as rows

**Each row of `agent_conversation_items` holds one pi session entry, unchanged.** The body is the
entry, gzipped and sealed with the workspace data key. Nothing parses or validates it on write, so
thinking, signatures, response IDs, and block types from a later pi version survive. The row ID is
the entry ID. A conversation has no branches, so the loader derives `parentId` from `seq`.

**An entry gets its `seq` once.** A queued input has a null `seq`, and a claim assigns it under the
conversation row lock. A turn's own entries get theirs when they commit. One order serves the
prompt, the timeline, and every cursor. A message posted during a tool call can't land between
that call and its result, which providers reject.

**The loader rebuilds each prompt from the rows.** It reads from `context_start_seq`, migrates
rows of an older `session_version` in memory, and opens `SessionManager.inMemory`. pi then derives
the messages, the system prompt, and the tools. Agent assembles nothing at call time. A test
compares Agent's version constant with pi's `CURRENT_SESSION_VERSION`.

**A row that can't be opened fails the turn.** pi's path walk stops at a missing parent, so a skipped
row would silently cut the prompt. Reads of the timeline still return that row with no content.

### The system prompt and tools are pinned at `seq` 1

**The first entry holds the base prompt, a project header, and the tool definitions in
`toolsAdded`.** `beginTurn` writes it first, before anything claims a `seq`. pi reads only a leading
system message as the base prompt, so a later entry would not do. A release that changes the
built-in prompt, or a new tool, reaches new conversations only.

### A workflow per conversation, with Postgres holding the inputs

**`agentConversationWorkflow` runs on the `agent-conversation` task queue.** Workflow ID
`agent-conversation:<id>` makes one workflow per conversation. A route commits the input, then calls
`signalWithStart`. The signal says "look again" and carries nothing, so no message content enters
Temporal history. A failed signal is logged and never fails the caller.

The workflow ends when nothing is queued. It does not live for days, and a wait costs no compute.

| Activity | Does | Repeat after a crash |
| --- | --- | --- |
| `beginTurn` | Pins the prompt, then opens a turn and claims the queued inputs | Returns the running turn |
| `claimPendingInputs` | Assigns `seq` before each model call | Claims nothing new |
| `modelCall` | Rebuilds the prompt, streams, stores the reply as one entry | Returns the stored reply |
| `toolCall` | Reads the call from the stored reply, runs it, stores a `toolResult` entry | Returns the stored result |
| `finishTurn` | Records the final status and failure code | Leaves a finished turn alone |

**The write position makes each commit idempotent.** An assistant entry is unique on
`(turn_id, model_call_index)`, and a tool result adds `call_index`. The workflow supplies the
indexes, so a retry computes the same position.

**A turn ends in one of two states.** It succeeds when a reply has no tool calls. It fails with a
`failure_code` when a model call can't continue, or with `step_limit` after 25 model calls. A
failed turn keeps its inputs claimed, so a failing provider can't cause a retry loop.

### Model calls run inside activities

**`modelCall` builds the model with `@shipfox/node-pi-runtime` and streams with
`ModelRuntime.streamSimple`.** It passes the conversation ID as `sessionId`, which sets OpenAI's
`prompt_cache_key` and session affinity where a provider supports it. It flushes sealed text chunks
about every 150 ms and heartbeats. It writes the whole reply and deletes the chunks in one
transaction.

**pi loads with a dynamic `import()` inside the activity.** It never reaches the workflow bundle or
API startup.

**A failed call stores nothing.** Only the turn's `failure_code` records the cause. A transient
provider error, such as a 429, a 5xx, or a network failure, becomes a Temporal retry, up to 3
attempts. Any other 4xx, a denial, or a context overflow fails the turn at once. A retry before the commit repeats a model call, which costs tokens only.

**Credentials take a subject.** Every call passes `{kind: 'conversation', projectId,
conversationId, agentKey}`, so Usage attributes tokens to the conversation and the agent. Once a
turn has made a model call, later calls pass `renewal: true`, so a model locked mid-turn doesn't cut
the turn off.

### Tools run through the Integrations module

**Every tool goes through `integrations.callTool`, in-process, with a typed `conversation` caller instead of a token.** `callItemId` is
`<assistant item ID>:<call_index>`, so a retried call can't change its idempotency key. The owner
of a web conversation is the actor.

**The pinned definitions tell the model what it may call, and the live catalog runs the call.**
Dispatch needs the provider and sensitivity, which only the catalog has. A tool that a release
removed answers with an error the model reads.

**A result is capped at 64 KiB and wrapped as untrusted data when written.** The cap counts the
wrapper, so the stored bytes stay within it. The wrapper is part of the stored bytes, so every later prompt carries it. A result can't close the tag early, because
its closing tags are defanged first. A failure with no retries left becomes an error result, and
the model decides what to do.

### A custom provider URL is called through a pinned fetch

**The API process now sends attacker-influenced content to a URL a workspace chose.** The
preflight DNS check that guards a credential probe doesn't protect a long conversation, and a
runner's sandbox limit doesn't apply here.

**The pinned `fetch` checks the address the socket connects to.** It resolves the host inside the
socket's own lookup, checks every address against the egress policy, and connects to one of them.
It refuses redirects. It is built to carry the `options.fetch` that pi passes to its providers.
Whether the `google-generative-ai` API honors that option is unverified, so a custom provider on
that API may bypass the policy until someone checks. The managed gateway is an operator-configured URL and uses the default
`fetch`. Cloud disables workspace providers, so this applies to other deployments.

### Limits

| Limit | Value | At the limit |
| --- | --- | --- |
| Model calls per turn | 25 | A turn that needs another call fails with `step_limit` |
| Tool result stored | 64 KiB | Truncated, with a notice in the result |
| Concurrent activities per process on the conversation queue | 50 | Temporal queues the rest |

The task queue boundary lets a dedicated worker process take the load later with no design change.

### Metrics

Labels stay bounded, and no conversation, project, or user ID is a label.

| Metric | Labels |
| --- | --- |
| `agent_conversation_turns` | `origin`, `trigger`, `outcome` |
| `agent_conversation_first_token_seconds` | `origin` |
| `agent_conversation_model_calls` | `outcome` |
| `agent_conversation_tool_calls` | `sensitivity`, `outcome` |
| `agent_conversation_thinking_dropped` | None |

`agent_conversation_thinking_dropped` counts the input transformations pi's Anthropic adapter
reports. A rising count means a conversation's prefix changed.

## Alternatives considered

- **Store a conversation in `agent_sessions`.** It requires a run attempt, has one writer, retires
  at run end, and rewrites the whole transcript on every commit. A conversation commits after every
  model and tool call.
- **Parse messages into Agent's own shape.** Thinking, signatures, and new block types would need
  a mapping for every pi change, and a lossy mapping breaks the cache and signed thinking.
- **Run the loop in one long activity.** A deploy would lose the turn, and a stop or an input
  would have no seam to arrive at.
- **Put message content in the signal.** It would copy private text into Temporal history, outside
  the sealed store.
- **Assign `seq` when a message is posted.** A message could then land between a tool call and its
  result.
- **Rebuild the prompt on each call.** A release or a catalog change would break signatures and the
  cache of a running conversation.

## Consequences

- **The API process runs inference.** Its memory and concurrency now matter. pi adds about 211 MB
  of resident memory and a first-call import of about 1.1 s per process.
- **Admission, stop, retry, and the recovery sweep come next.** Until they land, nothing re-wakes
  a conversation after a failed signal, and a failed turn stays failed. A message sent after a
  failed turn starts a new turn, with the model-call count back at 0.
- **Compaction comes next.** A prompt over the context window fails with `context_overflow`.
- **A pi upgrade needs no data migration**, because rows are never rewritten. A change to pi's
  session format needs a migration step in the loader.
- **Entries are never edited.** A client that reads by `seq` sees every change as a new entry.
