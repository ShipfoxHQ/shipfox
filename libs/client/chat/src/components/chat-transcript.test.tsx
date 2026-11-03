import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {act, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {buildTranscript} from '#core/transcript.js';
import type {ReplyActivity} from '#core/turn-state.js';
import {
  agentRow,
  OLD_TURN_ID,
  rowsItem,
  toolCall,
  userItem,
} from '#test/fixtures/conversation-items.js';
import {ChatTranscript, type ChatTranscriptProps} from './chat-transcript.js';

const RUN_LINK_NAME = /run #214/;

async function renderTranscript(props: Partial<ChatTranscriptProps> & {activity?: ReplyActivity}) {
  const transcript = (
    <ChatTranscript
      entries={props.entries ?? []}
      workspaceSlug="acme"
      projectSlug="api"
      activity={props.activity ?? {kind: 'idle'}}
      renderNotice={() => null}
      olderHistory={{hasMore: false, loading: false, load: () => undefined}}
      {...props}
    />
  );
  const rootRoute = createRootRoute({component: Outlet});
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs',
    component: () => transcript,
  });
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: () => transcript,
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: ['/w/acme/p/api/runs']}),
    routeTree: rootRoute.addChildren([pageRoute, runRoute]),
  });
  await router.load();
  await act(() => {
    render(<RouterProvider router={router} />);
  });
  return router;
}

describe('ChatTranscript', () => {
  test('is a silent log, so streamed tokens are not read out', async () => {
    await renderTranscript({
      entries: buildTranscript({
        items: [userItem(1, 'Why did this fail?')],
        queued: [],
        partialText: 'Because',
        runningTurnId: OLD_TURN_ID,
      }),
    });

    const log = screen.getByRole('log');
    expect(log).toHaveAttribute('aria-live', 'off');
    expect(within(log).getByText('Why did this fail?')).toBeInTheDocument();
    expect(within(log).getByText('Because')).toBeInTheDocument();
  });

  test('shows queued messages, a stopped reply, and a call with an unknown result', async () => {
    await renderTranscript({
      entries: buildTranscript({
        items: [
          rowsItem({seq: 1, turnId: OLD_TURN_ID, rows: [toolCall('call', 'get_workflow_run')]}),
          rowsItem({seq: 2, turnId: OLD_TURN_ID, rows: [agentRow('The run fail', 'aborted')]}),
        ],
        queued: [userItem(null, 'And the lint job?', 'queued')],
        partialText: '',
        runningTurnId: undefined,
      }),
    });

    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByRole('img', {name: 'Result unknown'})).toBeInTheDocument();
  });

  test('shows a started run with its number and a link to the run', async () => {
    const runId = '44444444-4444-4444-8444-444444444444';
    await renderTranscript({
      entries: [{kind: 'run-started', key: 'run', run: {runId, number: 12, name: 'Deploy'}}],
    });

    expect(screen.getByText('Run started')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Deploy #12'})).toHaveAttribute(
      'href',
      `/w/acme/p/api/runs/${runId}`,
    );
  });

  test('says when a reply is slow to start', async () => {
    await renderTranscript({entries: [], activity: {kind: 'slow-start'}});
    expect(screen.getByText('Taking longer than usual to start.')).toBeInTheDocument();
  });

  test('moves the page for a link to a Shipfox page, and keeps the panel', async () => {
    const runPath = '/w/acme/p/api/runs/44444444-4444-4444-8444-444444444444';
    const router = await renderTranscript({
      entries: [
        {
          kind: 'agent',
          key: 'reply',
          text: `See [run #214](${window.location.origin}${runPath}).`,
          stopped: false,
          streaming: false,
        },
      ],
    });

    await userEvent.click(screen.getByRole('link', {name: RUN_LINK_NAME}));

    expect(router.state.location.pathname).toBe(runPath);
  });
});
