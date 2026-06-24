import type {Meta, StoryObj} from '@storybook/react';
import {expect, userEvent, within} from 'storybook/test';
import type {WorkflowRun, WorkflowRunStatus} from '#core/workflow-run.js';
import {sequencedWorkflowRun} from '#test/fixtures/workflow-run.js';
import type {WorkflowRunsListQuery} from './types.js';
import {WorkflowRunsListView} from './workflow-runs-list-view.js';

// Stand-in for the react-query result the view reads. `data !== undefined` is the
// "loaded at least once" signal that splits a fresh load error from a stale refresh.
function makeQuery(overrides: Partial<WorkflowRunsListQuery> = {}): WorkflowRunsListQuery {
  return {
    isPending: false,
    isError: false,
    isFetching: false,
    data: {pages: [], pageParams: []},
    error: null,
    refetch: () => undefined,
    ...overrides,
  };
}

function makeRun(status: WorkflowRunStatus, name: string, minutesAgo: number): WorkflowRun {
  return sequencedWorkflowRun(status, name, minutesAgo);
}

const SAMPLE_RUNS: WorkflowRun[] = [
  makeRun('running', 'deploy-web', 1),
  makeRun('failed', 'integration-tests', 4),
  makeRun('succeeded', 'build-image', 12),
  makeRun('cancelled', 'lint-and-type', 38),
  makeRun('pending', 'release-prod', 0),
  makeRun('succeeded', 'release-production-multi-region-with-canary-and-smoke-tests', 95),
];

// One story on the full rail. The data states (loading / empty / errors / runs) are
// driven by args; search, status filter, "clear filters" and "no matches" are live in
// the rendered toolbar since the view owns that state. The decorator gives the rail a
// real height so `flex-1` content scrolls the way it does in the app shell.
const meta = {
  title: 'Workflows/RunsList',
  component: WorkflowRunsListView,
  parameters: {layout: 'centered'},
  decorators: [
    (Story) => (
      <div className="flex h-600">
        <Story />
      </div>
    ),
  ],
  args: {
    runs: SAMPLE_RUNS,
    query: makeQuery(),
    workspaceId: 'ws-demo',
    projectId: 'proj-demo',
  },
} satisfies Meta<typeof WorkflowRunsListView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithRuns: Story = {};

export const Selected: Story = {
  args: {selectedRunId: SAMPLE_RUNS[1].id},
};

export const Loading: Story = {
  args: {query: makeQuery({isPending: true, data: undefined})},
};

export const Empty: Story = {
  args: {runs: []},
};

// Runs exist but the search matches none of them: a distinct empty state ("No matching
// runs" + Clear filters) from the never-ran Empty story. Typed in via the real search box
// since the view owns the query, so the story shows the whole rail in that state.
export const NoMatches: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Search runs'), 'no-such-run');
    await expect(await canvas.findByText('No matching runs')).toBeInTheDocument();
  },
};

export const LoadError: Story = {
  args: {runs: [], query: makeQuery({isError: true, data: undefined})},
};

export const StaleError: Story = {
  args: {query: makeQuery({isError: true})},
};
