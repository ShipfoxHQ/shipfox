# Shipfox Agent Transcript

Shipfox Agent Transcript turns agent session entries into `SessionView` rows.

## What it does

- **`parseSessionRecord(record, harness, context?)`**: Parses one pi or Claude
  session entry into `SessionView` rows. An entry it can't parse becomes a
  single `raw` row.
- **`createClaudeParseContext`**: Creates the Claude parser state. Pass it to
  `parseSessionRecord` through `SessionParseContext` and reuse it across entries.
- **`claudeInitSessionId`**: Returns the session ID of a Claude init entry.
- **`flushPendingToolRows`**: Returns and clears the tool rows held in the Claude
  parser state.
- **`AgentSessionRecord`**, **`SessionParseContext`**, **`ClaudeParseContext`**:
  Types for the input record and the parser state.

The `SessionView` row schemas stay in `@shipfox/api-logs-dto`.

## Installation and setup

```sh
npm install @shipfox/agent-transcript
```

## Usage

```ts
import {parseSessionRecord} from '@shipfox/agent-transcript';

const rows = parseSessionRecord(
  {
    ts: Date.now(),
    data: JSON.stringify({
      type: 'message',
      message: {role: 'user', content: 'Why did the build fail?'},
    }),
  },
  'pi',
);
```

## Behavior notes

The package is pure. It does no input or output, uses no Node APIs, and imports
no provider SDK.

## Development

```sh
turbo check --filter=@shipfox/agent-transcript
turbo type --filter=@shipfox/agent-transcript
turbo test --filter=@shipfox/agent-transcript
```

## License

MIT
