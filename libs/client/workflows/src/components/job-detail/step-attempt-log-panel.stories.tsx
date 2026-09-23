import {type LogRecord, type StepLogSnapshot, stepLogsQueryKeys} from '@shipfox/client-logs';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useRef, useState} from 'react';
import {userEvent, within} from 'storybook/test';
import {stepAttemptDetailQueryKeys} from '#hooks/api/step-attempt-detail.js';
import {StepAttemptLogPanel} from './step-attempt-log-panel.js';

const stepId = '99999999-9999-4999-8999-999999999999';
const GROUPED_INTEGRATION_BUTTON_NAME = /Linear · Get Issue, 2 reads/;
const origin = Date.parse('2026-09-23T10:00:00.000Z');
const at = (index: number) => origin + index * 1000;

function read(
  id: string,
  name: string,
  input: Record<string, unknown>,
  index: number,
): LogRecord[] {
  return [
    {
      v: 1,
      ts: at(index),
      type: 'agent_session',
      row: {kind: 'tool-call', timestamp: at(index), id, name, input: JSON.stringify(input)},
    },
    {
      v: 1,
      ts: at(index + 1),
      type: 'agent_session',
      row: {
        kind: 'tool-result',
        timestamp: at(index + 1),
        toolCallId: id,
        toolName: name,
        output: `${id} recorded result`,
        isError: false,
      },
    },
  ];
}

const records: LogRecord[] = [
  ...read('pi-one', 'read_file', {path: 'src/main.ts'}, 0),
  ...read('pi-two', 'read_file', {path: 'src/helper.ts'}, 2),
  {
    v: 1,
    ts: at(4),
    type: 'agent_session',
    row: {
      kind: 'message',
      timestamp: at(4),
      role: 'assistant',
      label: 'assistant',
      text: 'Now checking the Claude view.',
      meta: [],
      terminalFailure: false,
    },
  },
  ...read('claude-one', 'Read', {file_path: 'src/view.tsx'}, 5),
  ...read('claude-two', 'Read', {file_path: 'src/panel.tsx'}, 7),
  ...read(
    'linear-one',
    'mcp__shipfox_integration_tools__tickets_main__get_issue',
    {id: 'ENG-2311'},
    9,
  ),
  ...read(
    'linear-two',
    'mcp__shipfox_integration_tools__tickets_main__get_issue',
    {id: 'ENG-2312'},
    11,
  ),
];

function snapshot(value: readonly LogRecord[], complete: boolean): StepLogSnapshot {
  return {
    records: value,
    nextCursor: value.length,
    source: 'inline',
    state: complete ? 'closed' : 'open',
    complete,
    hasMore: false,
    truncated: false,
    totalBytes: null,
    expiresAt: null,
  };
}

function PanelStory({live = false}: {live?: boolean}) {
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const [client] = useState(() => {
    const queryClient = new QueryClient({
      defaultOptions: {queries: {staleTime: Number.POSITIVE_INFINITY}},
    });
    queryClient.setQueryData(
      stepLogsQueryKeys.detail(stepId, 1),
      snapshot(live ? records.slice(0, -1) : records, !live),
    );
    queryClient.setQueryData(stepAttemptDetailQueryKeys.detail(stepId, 1), {
      config: {
        integrations: [
          {
            provider: 'linear',
            connectionId: 'tickets-main',
            connectionSlug: 'tickets-main',
            tools: [{id: 'get_issue', sensitivity: 'read'}],
          },
        ],
      },
    });
    return queryClient;
  });
  return (
    <QueryClientProvider client={client}>
      <div ref={pageScrollRef} className="h-480 overflow-y-auto bg-background-neutral-base px-16">
        {live ? (
          <button
            type="button"
            className="my-8 underline"
            onClick={() =>
              client.setQueryData(stepLogsQueryKeys.detail(stepId, 1), snapshot(records, false))
            }
          >
            Complete next read
          </button>
        ) : null}
        <StepAttemptLogPanel
          stepId={stepId}
          attempt={1}
          attemptStatus={live ? 'running' : 'succeeded'}
          pageScrollRef={pageScrollRef}
        />
      </div>
    </QueryClientProvider>
  );
}

const meta = {title: 'Workflows/StepAttemptLogPanel'} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const GroupedReads: Story = {
  render: () => <PanelStory />,
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', {name: GROUPED_INTEGRATION_BUTTON_NAME}),
    );
  },
};

export const LiveGrouping: Story = {
  render: () => <PanelStory live />,
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', {name: 'Complete next read'}));
  },
};
