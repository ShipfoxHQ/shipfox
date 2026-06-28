import type {LogRecord} from '@shipfox/api-logs-dto';
import type {Meta, StoryObj} from '@storybook/react';
import {LogView, LogViewSkeleton} from './log-view.js';

const ESC = String.fromCharCode(27);
const origin = new Date('2026-06-23T10:00:00.000Z').getTime();
const at = (offsetSeconds: number) => origin + offsetSeconds * 1000;

const out = (data: string, offset: number, stream: 'stdout' | 'stderr' = 'stdout'): LogRecord => ({
  v: 1,
  ts: at(offset),
  type: 'output',
  stream,
  data,
});
const session = (data: unknown, offset: number): LogRecord => ({
  v: 1,
  ts: at(offset),
  type: 'agent_session',
  data: typeof data === 'string' ? data : JSON.stringify(data),
});
const groupStart = (
  groupId: string,
  name: string,
  offset: number,
  parentGroupId: string | null = null,
): LogRecord => ({
  v: 1,
  ts: at(offset),
  type: 'group_start',
  group_id: groupId,
  parent_group_id: parentGroupId,
  name,
});
const groupEnd = (groupId: string, offset: number): LogRecord => ({
  v: 1,
  ts: at(offset),
  type: 'group_end',
  group_id: groupId,
});

const showcaseRecords: LogRecord[] = [
  out('$ pnpm build && pnpm test\n', 0),
  groupStart('g1', 'Install dependencies', 1),
  out('Resolving packages...\n', 2),
  out('Linking 318 packages\n', 3),
  groupEnd('g1', 4),
  groupStart('g2', 'Build', 5),
  out(`${ESC}[32m✓${ESC}[0m built ${ESC}[34m1284${ESC}[0m modules\n`, 6),
  out('warn: deprecated glob@7, upgrade to glob@10\n', 7, 'stderr'),
  groupEnd('g2', 8),
  groupStart('g3', 'Test', 9),
  out('running 42 tests\n', 10),
  out('FAIL client.test.ts > retries on 503\n', 11, 'stderr'),
  groupEnd('g3', 12),
  {v: 1, ts: at(13), type: 'gap', dropped_bytes: 2048},
  {v: 1, ts: at(14), type: 'end', total_bytes: 15_360},
];

// A pipeline nested three levels deep: Deploy > Build > Compile, and Deploy >
// Test > {unit, e2e}. The e2e leaf writes to stderr, so its error bubbles up to
// Test and the top-level pipeline (visible as an inset bar when those groups are
// collapsed); the Build branch stays clean. Closed inner groups carry a duration.
const nestedRecords: LogRecord[] = [
  groupStart('g1', 'Deploy pipeline', 0),
  out('$ ./deploy.sh\n', 0.1),
  groupStart('g2', 'Build', 1, 'g1'),
  out('resolving workspace graph\n', 1.2),
  groupStart('g3', 'Compile @app/web', 2, 'g2'),
  out(`${ESC}[32m✓${ESC}[0m built ${ESC}[34m842${ESC}[0m modules\n`, 3),
  groupEnd('g3', 4),
  groupStart('g4', 'Compile @app/api', 4.2, 'g2'),
  out('tsc --build\n', 5),
  out('✓ 1.1k files emitted\n', 6),
  groupEnd('g4', 7),
  groupEnd('g2', 7.5),
  groupStart('g5', 'Test', 8, 'g1'),
  groupStart('g6', 'unit', 8.2, 'g5'),
  out('running 128 tests\n', 9),
  out('✓ 128 passed\n', 10),
  groupEnd('g6', 11),
  groupStart('g7', 'e2e', 11.2, 'g5'),
  out('running 12 specs\n', 12),
  out('FAIL checkout.spec.ts > applies coupon at checkout\n', 13, 'stderr'),
  groupEnd('g7', 14),
  groupEnd('g5', 14.5),
  groupEnd('g1', 15),
  {v: 1, ts: at(15.2), type: 'end', total_bytes: 9_216},
];

const unifiedAgentRecords: LogRecord[] = [
  session(
    {
      type: 'message',
      message: {role: 'user', content: 'Update the auth form error handling.'},
    },
    0,
  ),
  session(
    {
      type: 'message',
      message: {
        role: 'assistant',
        model: 'gpt-5-codex',
        content: [
          {type: 'text', text: 'I will inspect the form and the existing tests first.'},
          {
            type: 'thinking',
            text: 'The likely risk is server errors being written to the wrong form meta slot.',
          },
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'read_file',
            arguments: {path: 'src/login-form.tsx'},
          },
        ],
      },
    },
    1,
  ),
  out('$ pnpm --filter @shipfox/client-auth test\n', 2),
  session(
    {
      type: 'message',
      message: {
        toolCallId: 'call-1',
        toolName: 'read_file',
        content: [{type: 'text', text: 'export function LoginForm() { /* ... */ }'}],
      },
    },
    3,
  ),
  session({type: 'model_change', model: 'gpt-5-codex', provider: 'openai'}, 4),
  {v: 1, ts: at(5), type: 'end', total_bytes: 4096},
];

const awaitingAgentRecords: LogRecord[] = [
  session(
    {
      type: 'message',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call-2',
            name: 'run_tests',
            arguments: {filter: '@shipfox/client-logs'},
          },
        ],
      },
    },
    0,
  ),
  out('running tests...\n', 1),
];

const failedAgentRecords: LogRecord[] = [
  out('$ pnpm test\n', 0),
  session(
    {
      type: 'message',
      message: {
        role: 'assistant',
        content: [{type: 'text', text: 'The run cannot continue because the harness aborted.'}],
        stopReason: 'error',
      },
    },
    1,
  ),
];

const allAgentSessionTypeRecords: LogRecord[] = [
  session({type: 'session', version: 2, id: 'session-2026-06-23', cwd: '/workspace/platform'}, 0),
  session({type: 'session_info', message: 'Restored 14 messages from prior context.'}, 1),
  session({type: 'label', label: 'Review setup', targetId: 'entry-review'}, 2),
  session({type: 'thinking_level_change', thinkingLevel: 'high'}, 3),
  session({type: 'model_change', modelId: 'gpt-5-codex', provider: 'openai'}, 4),
  session(
    {
      type: 'message',
      message: {
        role: 'user',
        content: [
          {type: 'text', text: 'Review the failed workflow attempt and patch the tests.'},
          {type: 'image', mimeType: 'image/png', data: 'base64-payload'},
        ],
      },
    },
    5,
  ),
  session(
    {
      type: 'message',
      message: {
        role: 'assistant',
        model: 'gpt-5-codex',
        provider: 'openai',
        content: [
          {type: 'text', text: 'I will inspect the failure anchor and the log selector.'},
          {
            type: 'thinking',
            thinking:
              'The UI needs to preserve the terminal assistant message while still showing the tool activity inline.',
          },
          {
            type: 'tool_call',
            id: 'call-read',
            name: 'read_file',
            arguments: {path: 'libs/client/logs/src/core/agent-session/selector.ts'},
          },
        ],
      },
    },
    6,
  ),
  session(
    {
      type: 'message',
      message: {
        role: 'toolResult',
        toolCallId: 'call-read',
        toolName: 'read_file',
        content: [{type: 'text', text: 'function expandSessionRecord(record) { /* ... */ }'}],
      },
    },
    7,
  ),
  session(
    {
      type: 'message',
      message: {
        toolCallId: 'call-test',
        toolName: 'run_tests',
        content: [{type: 'text', text: 'FAIL selector.test.ts > parses tool results'}],
        isError: true,
      },
    },
    8,
  ),
  session(
    {
      type: 'branch_summary',
      summary: 'Kept the parser scoped to agent_session records and log-tree ordering.',
      fromId: 'entry-review',
    },
    9,
  ),
  session(
    {
      type: 'compaction',
      summary: 'Previous context summarized into 3 decisions.',
      tokensBefore: 42000,
    },
    10,
  ),
  session(
    {type: 'custom', customType: 'review', data: {verdict: 'parser coverage looks complete'}},
    11,
  ),
  session(
    {
      type: 'custom_message',
      customType: 'operator-note',
      content: 'Retry after the fixture update.',
    },
    12,
  ),
  session(
    {
      type: 'message',
      message: {
        role: 'assistant',
        content: [{type: 'text', text: 'I cannot continue because the test harness aborted.'}],
        stopReason: 'aborted',
        errorMessage: 'Harness aborted before the retry finished.',
      },
    },
    13,
  ),
  session(
    {
      type: 'message',
      message: {
        role: 'bashExecution',
        command: 'pnpm test',
        output: 'FAIL selector.test.ts > parses tool results',
        exitCode: 1,
        cancelled: false,
        truncated: true,
        fullOutputPath: '/tmp/shipfox-agent-output.log',
      },
    },
    14,
  ),
  session(
    {
      type: 'message',
      message: {
        role: 'custom',
        customType: 'status',
        content: 'Extension status update.',
        display: true,
      },
    },
    15,
  ),
  session(
    {
      type: 'message',
      message: {
        role: 'branchSummary',
        summary: 'Created a branch for selector fixes.',
        fromId: 'entry-review',
      },
    },
    16,
  ),
  session(
    {
      type: 'message',
      message: {
        role: 'compactionSummary',
        summary: 'Summarized earlier tool output.',
        tokensBefore: 96000,
      },
    },
    17,
  ),
  session({type: 'future_entry', payload: {feature: 'new-session-event'}}, 18),
  {v: 1, ts: at(19), type: 'agent_session', data: '{not-json'},
  {v: 1, ts: at(20), type: 'end', total_bytes: 12_288},
];

const meta = {
  title: 'Logs/LogView',
  component: LogView,
  parameters: {layout: 'padded'},
  tags: ['autodocs'],
  argTypes: {
    timestamps: {control: 'inline-radio', options: ['off', 'rel', 'abs']},
    wrap: {control: 'boolean'},
    showLineNumbers: {control: 'boolean'},
  },
  args: {
    timestamps: 'off',
    wrap: false,
    showLineNumbers: true,
  },
} satisfies Meta<typeof LogView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Showcase: Story = {
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={showcaseRecords} />
    </div>
  ),
};

/**
 * Groups nested three levels deep (Deploy > Build > Compile, Deploy > Test >
 * unit/e2e). Each level indents; the failing `e2e` leaf bubbles its error up to
 * `Test` and `Deploy pipeline`. Collapse any group to see its "N lines" summary,
 * duration, and (for a branch with a failure) the inset error bar.
 */
export const NestedGroups: Story = {
  args: {defaultGroupsOpen: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={nestedRecords} />
    </div>
  ),
};

export const ClosedEmpty: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={[]} />
    </div>
  ),
};

export const PendingEmpty: Story = {
  args: {showLineNumbers: true, emptyState: 'pending'},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={[]} />
    </div>
  ),
};

export const MinimalOutput: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={[{v: 1, ts: at(1), type: 'end', total_bytes: 0}]} />
    </div>
  ),
};

export const UnifiedAgentSession: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={unifiedAgentRecords} />
    </div>
  ),
};

export const AllAgentSessionTypes: Story = {
  args: {showLineNumbers: true, anchorToFailure: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={allAgentSessionTypeRecords} />
    </div>
  ),
};

export const RunningAgentToolCall: Story = {
  args: {showLineNumbers: true, emptyState: 'pending'},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={awaitingAgentRecords} />
    </div>
  ),
};

export const FailedAgentSession: Story = {
  args: {showLineNumbers: true, anchorToFailure: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={failedAgentRecords} />
    </div>
  ),
};

export const UnknownAgentEntry: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={[session({type: 'future_entry', payload: {value: true}}, 0)]} />
    </div>
  ),
};

export const LargeAgentPayload: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView
        {...args}
        records={[
          session(
            {
              type: 'message',
              message: {
                role: 'assistant',
                content: [{type: 'text', text: 'Large payload '.repeat(180)}],
              },
            },
            0,
          ),
        ]}
      />
    </div>
  ),
};

export const LoadingSkeleton: Story = {
  render: (args) => (
    <div className="max-w-3xl">
      <LogViewSkeleton
        timestamps={args.timestamps}
        wrap={args.wrap}
        showLineNumbers={args.showLineNumbers}
      />
    </div>
  ),
};
