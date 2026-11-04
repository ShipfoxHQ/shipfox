import type {Decorator, Meta, StoryObj} from '@storybook/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {type ReactNode, useState} from 'react';
import type {ActiveRun, ConversationSummary} from '#core/conversation.js';
import type {ProjectAgent} from '#core/project-agents.js';
import {buildTranscript, type TranscriptEntry} from '#core/transcript.js';
import {type ReplyActivity, turnFailure} from '#core/turn-state.js';
import {
  agentRow,
  noticeItem,
  OLD_TURN_ID,
  rowsItem,
  runResultItem,
  TURN_ID,
  toolCall,
  toolResult,
  userItem,
} from '#test/fixtures/conversation-items.js';
import {ChatHistory} from './chat-history.js';
import {NoModelState, TurnFailureNotice, TurnNoticeCallout} from './chat-notices.js';
import {
  AgentFileError,
  AgentPicker,
  AgentUnavailable,
  ChatPanelHeader,
  ChatPanelLayout,
  ConversationDeleted,
  FirstUse,
} from './chat-panel.js';
import {ChatActiveRuns} from './chat-runs.js';
import {ChatTranscript} from './chat-transcript.js';

const withRouter: Decorator = (Story) => {
  const rootRoute = createRootRoute({component: Outlet});
  const storyRoute = createRoute({getParentRoute: () => rootRoute, path: '/', component: Story});
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/settings/agents',
    component: () => null,
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: ['/']}),
    routeTree: rootRoute.addChildren([storyRoute, settingsRoute]),
  });
  return <RouterProvider router={router} />;
};

const meta = {
  title: 'Chat/Panel',
  decorators: [withRouter],
  parameters: {layout: 'centered'},
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const failureReply = `**The tests couldn't reach Postgres.** All 6 failures in \`settlement.test.ts\` are ECONNREFUSED on port 5432.

\`integration-tests\` has no database service. Add a \`postgres\` service to the job.`;

const answeredItems = [
  userItem(1, 'Why did this run fail?'),
  rowsItem({
    seq: 2,
    turnId: OLD_TURN_ID,
    rows: [toolCall('run', 'get_workflow_run', '{"run":"214"}')],
  }),
  rowsItem({seq: 3, turnId: OLD_TURN_ID, rows: [toolResult('run', 'get_workflow_run')]}),
  rowsItem({seq: 4, turnId: OLD_TURN_ID, rows: [toolCall('logs', 'get_step_logs')]}),
  rowsItem({seq: 5, turnId: OLD_TURN_ID, rows: [toolResult('logs', 'get_step_logs')]}),
  rowsItem({seq: 6, turnId: OLD_TURN_ID, rows: [agentRow(failureReply)]}),
];

function Frame({children}: {children: ReactNode}) {
  return (
    <div className="flex h-640 w-400 flex-col overflow-hidden border-l border-border-neutral-base bg-background-neutral-base">
      {children}
    </div>
  );
}

function Panel({
  title = 'Why did this run fail?',
  body,
  composer = true,
  replying = false,
  stopping = false,
  disabled = false,
  error,
  initialDraft = '',
  activeRuns,
}: {
  title?: string;
  activeRuns?: readonly ActiveRun[];
  body: ReactNode;
  composer?: boolean;
  replying?: boolean;
  stopping?: boolean;
  disabled?: boolean;
  error?: string;
  initialDraft?: string;
}) {
  const [draft, setDraft] = useState(initialDraft);
  return (
    <Frame>
      <ChatPanelLayout
        panelRef={null}
        onKeyDown={() => undefined}
        announcement=""
        header={
          <>
            <ChatPanelHeader
              title={title}
              view="chat"
              onToggleHistory={() => undefined}
              onNewConversation={() => undefined}
              onClose={() => undefined}
            />
            <ChatActiveRuns runs={activeRuns} workspaceSlug="acme" projectSlug="api" />
          </>
        }
        body={body}
        composer={
          composer
            ? {
                ref: null,
                value: draft,
                onValueChange: setDraft,
                onBlur: () => undefined,
                onSubmit: () => setDraft(''),
                contextLabel: 'Viewing run #214',
                replying,
                stopping,
                onStop: () => undefined,
                disabled,
                error,
                submitBlocked: error !== undefined,
              }
            : undefined
        }
      />
    </Frame>
  );
}

function Transcript({
  entries,
  activity = {kind: 'idle'},
  footer,
}: {
  entries: TranscriptEntry[];
  activity?: ReplyActivity;
  footer?: ReactNode;
}) {
  return (
    <ChatTranscript
      entries={entries}
      workspaceSlug="acme"
      projectSlug="api"
      activity={activity}
      olderHistory={{hasMore: false, loading: false, load: () => undefined}}
      renderNotice={(entry) => (
        <TurnNoticeCallout notice={entry.notice} busy={false} onSendAgain={() => undefined} />
      )}
      footer={footer}
    />
  );
}

const noop = () => undefined;

export const FirstUseOnFailedRun: Story = {
  render: () => (
    <Panel
      title="Shippy"
      body={<FirstUse prompts={['Why did this run fail?']} onPrompt={noop} />}
    />
  ),
};

const projectAgents: ProjectAgent[] = [
  {key: 'shippy', name: 'Shippy', description: null, error: null},
  {
    key: 'reviewer',
    name: 'Code reviewer',
    description: 'Reviews pull requests against the team checklist.',
    error: null,
  },
  {key: 'triage', name: null, description: null, error: null},
];

function PickerOnNewConversation({initial}: {initial: string}) {
  const [key, setKey] = useState(initial);
  const agent = projectAgents.find((candidate) => candidate.key === key);
  return (
    <Panel
      title="Shippy"
      body={
        <FirstUse
          prompts={[]}
          onPrompt={noop}
          agent={agent}
          picker={<AgentPicker agents={projectAgents} value={key} onChange={setKey} />}
        />
      }
    />
  );
}

export const NewConversationWithAgents: Story = {
  render: () => <PickerOnNewConversation initial="shippy" />,
};

export const NewConversationWithCustomAgent: Story = {
  render: () => <PickerOnNewConversation initial="reviewer" />,
};

export const InvalidAgentFile: Story = {
  render: () => (
    <Panel
      body={
        <>
          <AgentFileError
            agent={{
              key: 'reviewer',
              name: 'Code reviewer',
              description: null,
              error: 'instructions: a custom agent requires "instructions".',
            }}
          />
          <Transcript
            entries={buildTranscript({
              items: answeredItems,
              queued: [],
              partialText: '',
              runningTurnId: undefined,
            })}
          />
        </>
      }
    />
  ),
};

export const DeletedAgent: Story = {
  render: () => (
    <Panel
      disabled
      body={
        <>
          <AgentUnavailable onNewConversation={noop} />
          <Transcript
            entries={buildTranscript({
              items: answeredItems,
              queued: [],
              partialText: '',
              runningTurnId: undefined,
            })}
          />
        </>
      }
    />
  ),
};

export const Answered: Story = {
  render: () => (
    <Panel
      body={
        <Transcript
          entries={buildTranscript({
            items: answeredItems,
            queued: [],
            partialText: '',
            runningTurnId: undefined,
          })}
        />
      }
    />
  ),
};

const prReply =
  'The pull request is open: https://github.com/acme/api/pull/88. I will report back when review feedback arrives.';

function activeRun(
  number: number,
  name: string,
  status: string,
  progress: {finished: number; total: number} = {finished: 0, total: 0},
): ActiveRun {
  return {
    runId: `00000000-0000-4000-a000-${String(number).padStart(12, '0')}`,
    number,
    name,
    attempt: 1,
    status,
    startedAt: status === 'running' ? new Date(Date.now() - 4 * 60_000).toISOString() : undefined,
    jobsFinished: progress.finished,
    jobsTotal: progress.total,
  };
}

export const DelegatedRunSettled: Story = {
  render: () => (
    <Panel
      title="Add rate limiting to the API"
      activeRuns={[
        activeRun(215, 'implement', 'running', {finished: 2, total: 5}),
        activeRun(216, 'docs', 'pending'),
        activeRun(217, 'lint-fix', 'running'),
        activeRun(218, 'implement', 'waiting'),
      ]}
      body={
        <Transcript
          entries={buildTranscript({
            items: [
              userItem(1, 'Add rate limiting to the API'),
              rowsItem({
                seq: 2,
                turnId: OLD_TURN_ID,
                rows: [
                  toolCall('start', 'start_workflow_run', '{"workflow":"implement"}'),
                  {
                    kind: 'tool-result',
                    timestamp: 4,
                    toolCallId: 'start',
                    toolName: 'start_workflow_run',
                    output: JSON.stringify({
                      run_id: '55555555-5555-4555-8555-555555555555',
                      run_number: 214,
                      name: 'implement',
                    }),
                    isError: false,
                  },
                ],
              }),
              runResultItem({seq: 3, status: 'settled'}),
              rowsItem({seq: 4, turnId: OLD_TURN_ID, rows: [agentRow(prReply)]}),
              runResultItem({seq: 5, status: 'failed', attempt: 2}),
            ],
            queued: [],
            partialText: '',
            runningTurnId: undefined,
          })}
        />
      }
    />
  ),
};

export const StreamingWithQueuedMessage: Story = {
  render: () => (
    <Panel
      replying
      initialDraft="And the lint job?"
      body={
        <Transcript
          activity={{kind: 'replying'}}
          entries={buildTranscript({
            items: [
              userItem(1, 'Why did this run fail?'),
              rowsItem({seq: 2, turnId: TURN_ID, rows: [toolCall('run', 'get_workflow_run')]}),
              rowsItem({seq: 3, turnId: TURN_ID, rows: [toolResult('run', 'get_workflow_run')]}),
              rowsItem({seq: 4, turnId: TURN_ID, rows: [toolCall('logs', 'get_step_logs')]}),
            ],
            queued: [userItem(null, 'Did the lint job fail too?', 'queued')],
            partialText: "**The tests couldn't reach Postgres.** All 6 failures",
            runningTurnId: TURN_ID,
          })}
        />
      }
    />
  ),
};

export const Thinking: Story = {
  render: () => (
    <Panel
      replying
      body={
        <Transcript
          activity={{kind: 'thinking'}}
          entries={buildTranscript({
            items: [userItem(1, 'Summarize this run')],
            queued: [],
            partialText: '',
            runningTurnId: TURN_ID,
          })}
        />
      }
    />
  ),
};

export const Stopping: Story = {
  render: () => (
    <Panel
      replying
      stopping
      body={
        <Transcript
          activity={{kind: 'stopping'}}
          entries={buildTranscript({
            items: [
              userItem(1, 'Read every failed run this week'),
              rowsItem({seq: 2, turnId: TURN_ID, rows: [toolCall('runs', 'list_workflow_runs')]}),
            ],
            queued: [],
            partialText: '',
            runningTurnId: TURN_ID,
          })}
        />
      }
    />
  ),
};

export const Stopped: Story = {
  render: () => (
    <Panel
      body={
        <Transcript
          entries={buildTranscript({
            items: [
              userItem(1, 'Why did this run fail?'),
              rowsItem({
                seq: 2,
                turnId: OLD_TURN_ID,
                rows: [agentRow("The tests couldn't reach", 'aborted')],
              }),
            ],
            queued: [],
            partialText: '',
            runningTurnId: undefined,
          })}
        />
      }
    />
  ),
};

export const WaitingToStart: Story = {
  render: () => (
    <Panel
      body={
        <Transcript
          activity={{kind: 'slow-start'}}
          entries={buildTranscript({
            items: [],
            queued: [userItem(null, 'Why did this run fail?', 'queued')],
            partialText: '',
            runningTurnId: undefined,
          })}
        />
      }
    />
  ),
};

export const Reconnecting: Story = {
  render: () => (
    <Panel
      replying
      body={
        <Transcript
          activity={{kind: 'reconnecting'}}
          entries={buildTranscript({
            items: [userItem(1, 'Why did this run fail?')],
            queued: [],
            partialText: "The tests couldn't reach Postgres.",
            runningTurnId: TURN_ID,
          })}
        />
      }
    />
  ),
};

function failedTurn(failureCode: string, model?: Parameters<typeof TurnFailureNotice>[0]['model']) {
  return (
    <Panel
      disabled={failureCode === 'context_overflow'}
      body={
        <Transcript
          entries={buildTranscript({
            items: [userItem(1, 'Why did this run fail?')],
            queued: [],
            partialText: '',
            runningTurnId: undefined,
          })}
          footer={
            <TurnFailureNotice
              failure={turnFailure(failureCode)}
              model={model}
              workspaceSlug="acme"
              busy={false}
              onRetry={noop}
              onNewConversation={noop}
            />
          }
        />
      }
    />
  );
}

export const ProviderFailed: Story = {render: () => failedTurn('provider_unavailable')};

export const StepLimit: Story = {render: () => failedTurn('step_limit')};

export const TooLong: Story = {render: () => failedTurn('context_overflow')};

export const ModelLocked: Story = {
  render: () =>
    failedTurn('model_unavailable', {
      label: 'Claude Opus 5.5',
      message: 'Your plan does not include this model.',
      action: {
        reason: 'plan_limit',
        message: 'Upgrade the plan',
        url: '/w/acme/settings/billing',
      },
    }),
};

export const OutOfCredits: Story = {
  render: () => (
    <Panel
      body={
        <Transcript
          entries={buildTranscript({
            items: [
              userItem(1, 'Why did this run fail?'),
              noticeItem(2, {
                code: 'admission-denied',
                message: null,
                requiredAction: {
                  reason: 'credits_depleted',
                  message: 'Add credits',
                  url: '/w/acme/settings/billing',
                },
              }),
            ],
            queued: [],
            partialText: '',
            runningTurnId: undefined,
          })}
        />
      }
    />
  ),
};

export const MessageTooLong: Story = {
  render: () => (
    <Panel
      initialDraft="A very long paste"
      error="This message is too long. Shorten it to send it."
      body={<FirstUse prompts={[]} onPrompt={noop} />}
    />
  ),
};

export const NoModel: Story = {
  render: () => (
    <Panel title="Shippy" composer={false} body={<NoModelState workspaceSlug="acme" />} />
  ),
};

export const DeletedInAnotherTab: Story = {
  render: () => (
    <Panel
      disabled
      initialDraft="Can you also check"
      body={<ConversationDeleted onNewConversation={noop} />}
    />
  ),
};

const conversations: ConversationSummary[] = [
  {
    id: 'c1',
    agentKey: 'shippy',
    title: 'Why did this run fail?',
    unread: true,
    lastSeq: 6,
    lastActivityAt: '2026-11-02T09:55:00.000Z',
    createdAt: '2026-11-02T09:50:00.000Z',
  },
  {
    id: 'c2',
    agentKey: 'shippy',
    title: 'What failed recently?',
    unread: false,
    lastSeq: 12,
    lastActivityAt: '2026-11-01T16:10:00.000Z',
    createdAt: '2026-11-01T16:00:00.000Z',
  },
  {
    id: 'c3',
    agentKey: 'shippy',
    title: null,
    unread: false,
    lastSeq: 2,
    lastActivityAt: '2026-10-28T11:00:00.000Z',
    createdAt: '2026-10-28T11:00:00.000Z',
  },
];

export const History: Story = {
  render: () => (
    <Frame>
      <ChatPanelLayout
        panelRef={null}
        onKeyDown={noop}
        announcement=""
        header={
          <ChatPanelHeader
            title="Conversations"
            view="history"
            onToggleHistory={noop}
            onNewConversation={noop}
            onClose={noop}
          />
        }
        body={
          <ChatHistory
            conversations={conversations}
            loading={false}
            selectedId="c1"
            replyingId={undefined}
            hasMore={false}
            loadingMore={false}
            onLoadMore={noop}
            onSelect={noop}
            onDelete={async () => true}
            deleting={false}
            deleteError={undefined}
            onDeleteDismissed={noop}
          />
        }
        composer={undefined}
      />
    </Frame>
  ),
};
