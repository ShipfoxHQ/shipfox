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

type ActionCallScenario = 'running' | 'recovered' | 'cancelled';

const actionStepId = '99999999-9999-4999-8999-999999999998';

function actionCall(
  id: string,
  name: string,
  input: Record<string, unknown>,
  index: number,
  result?: {output: unknown; isError?: boolean},
): LogRecord[] {
  const call: LogRecord = {
    v: 1,
    ts: at(index),
    type: 'agent_session',
    row: {kind: 'tool-call', timestamp: at(index), id, name, input: JSON.stringify(input)},
  };
  if (!result) return [call];
  return [
    call,
    {
      v: 1,
      ts: at(index + 1),
      type: 'agent_session',
      row: {
        kind: 'tool-result',
        timestamp: at(index + 1),
        toolCallId: id,
        toolName: name,
        output: JSON.stringify(result.output),
        isError: result.isError ?? false,
      },
    },
  ];
}

function actionRecords(scenario: ActionCallScenario): LogRecord[] {
  const banner: LogRecord = {
    v: 1,
    ts: at(0),
    type: 'output',
    stream: 'stdout',
    data: 'Shipfox action Linear context sha256:0123456789ab · node v24.3.0 · @shipfox/actions 0.4.1\n',
  };
  const settled = [
    banner,
    ...actionCall('call-1', 'tickets__get_issue', {id: 'ENG-2430'}, 1, {
      output: {identifier: 'ENG-2430', title: 'Show action steps on the run page'},
    }),
    ...actionCall('call-2', 'tickets__get_issue', {id: 'ENG-9999'}, 3, {
      output: {code: 'not-found', message: 'Issue ENG-9999 was not found', outcome_unknown: false},
      isError: true,
    }),
    {
      v: 1,
      ts: at(5),
      type: 'output',
      stream: 'stdout',
      data: 'Skipped ENG-9999: not found\n',
    } satisfies LogRecord,
    ...actionCall(
      'call-3',
      'tickets__download_file',
      {url: 'https://uploads.linear.app/design.pdf'},
      6,
      {
        output: {
          path: 'context/linear/files/design.pdf',
          filename: 'design.pdf',
          bytes: 2_621_440,
          media_type: 'application/pdf',
          sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
      },
    ),
  ];
  if (scenario === 'recovered') return settled;
  if (scenario === 'running') {
    return [...settled, ...actionCall('call-4', 'tickets__get_issue', {id: 'ENG-2431'}, 8)];
  }
  return [
    ...settled,
    ...actionCall('call-4', 'tickets__save_comment', {id: 'ENG-2430', body: 'Done'}, 8, {
      output: {code: 'provider-timeout', message: 'No answer from Linear', outcome_unknown: true},
      isError: true,
    }),
    ...actionCall('call-5', 'tickets__get_issue', {id: 'ENG-2431'}, 10),
  ];
}

const actionAttemptStatus: Record<ActionCallScenario, string> = {
  running: 'running',
  recovered: 'succeeded',
  cancelled: 'cancelled',
};

function ActionCallsStory({scenario}: {scenario: ActionCallScenario}) {
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const [client] = useState(() => {
    const queryClient = new QueryClient({
      defaultOptions: {queries: {staleTime: Number.POSITIVE_INFINITY}},
    });
    queryClient.setQueryData(
      stepLogsQueryKeys.detail(actionStepId, 1),
      snapshot(actionRecords(scenario), scenario !== 'running'),
    );
    queryClient.setQueryData(stepAttemptDetailQueryKeys.detail(actionStepId, 1), {
      config: {
        action: {uses: './.shipfox/actions/linear-context', digest: 'sha256:0123456789ab'},
        integrations: [
          {
            alias: 'tickets',
            provider: 'linear',
            connection_slug: 'tickets-main',
            tools: [
              {id: 'get_issue', sensitivity: 'read', result: 'json'},
              {id: 'save_comment', sensitivity: 'write', result: 'json'},
              {id: 'download_file', sensitivity: 'read', result: 'file'},
            ],
          },
        ],
      },
    });
    return queryClient;
  });
  return (
    <QueryClientProvider client={client}>
      <div ref={pageScrollRef} className="h-480 overflow-y-auto bg-background-neutral-base px-16">
        <StepAttemptLogPanel
          stepId={actionStepId}
          attempt={1}
          attemptStatus={actionAttemptStatus[scenario]}
          pageScrollRef={pageScrollRef}
        />
      </div>
    </QueryClientProvider>
  );
}

/** An action step's calls and downloads, in the tool-step presentation, while one call runs. */
export const ActionToolCallRunning: Story = {
  render: () => <ActionCallsStory scenario="running" />,
};

/** A caught call failure stays visible while the step succeeds. */
export const ActionToolCallRecovered: Story = {
  render: () => <ActionCallsStory scenario="recovered" />,
};

/** A cancelled step: an outcome-unknown write, and an unfinished call shown as interrupted. */
export const ActionToolCallsCancelled: Story = {
  render: () => <ActionCallsStory scenario="cancelled" />,
};
