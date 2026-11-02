# Shipfox Agent Transcript

Shipfox Agent Transcript turns agent session entries into `SessionView` rows.

## What it does

- **`parseSessionRecord(record, harness, context?)`**: Parses one pi or Claude
  session entry into `SessionView` rows. An entry it can't parse becomes a
  single `raw` row.
- **`createClaudeParseContext`**, **`claudeInitSessionId`**, **`flushPendingToolRows`**:
  Carry the Claude parser state. Claude tool calls stay pending until their result
  arrives, so the caller keeps this state between entries.
- **`AgentSessionRecord`**, **`SessionParseContext`**, **`ClaudeParseContext`**:
  Types for the input record and the parser state.

The `SessionView` row schemas stay in `@shipfox/api-logs-dto`.

## Installation and setup

```json
{
  "dependencies": {
    "@shipfox/agent-transcript": "workspace:*"
  }
}
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
