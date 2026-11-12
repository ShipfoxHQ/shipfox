# @shipfox/node-egress-guard

## 0.2.0

### Minor Changes

- 52969e5: Runs agent conversation turns on Temporal, with model calls on the server and no runner.

  - **Agent:** `createAgentModule` takes an `integrations` client. With it and `projects`, the module runs one `agentConversationWorkflow` per conversation on the `agent-conversation` queue. Its activities rebuild each prompt from the stored pi entries, stream the reply, run tools through `integrations.callTool`, and store each result once. The first entry pins the base prompt and tools. A turn stops after 25 model calls.
  - **Server:** the default composition passes the Integrations client to Agent.
  - **Module:** a worker can set `maxConcurrentActivityTaskExecutions`.
  - **Egress guard:** `assertEgressAllowed` takes an optional `lookup`, so a caller can check the addresses it connects to.
  - **Templates:** `getBuiltInAgentPrompt` reads the base prompt of a built-in agent. The package embeds `assets/agents/shippy.md`.

## 0.1.4

### Patch Changes

- b416c4c: Preserves existing package behavior while simplifying internal control flow.

## 0.1.3

### Patch Changes

- 4b85404: Adds versioned architecture identity to participating package artifacts during publication.

## 0.1.2

### Patch Changes

- 475ce59: Republishes all public packages after restoring release authorization.

## 0.1.1

### Patch Changes

- bb037af: Resolves workspace packages from source during development while published consumers continue to use compiled output.

## 0.1.0

### Minor Changes

- 1b0d344: Publishes the complete API runtime closure with packed-consumer-safe internal imports and records its exact package set in application releases.
