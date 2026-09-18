import type {Definition, DefinitionSyncSummary} from '@shipfox/client-projects';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import type {Meta, StoryObj} from '@storybook/react';
import {expect, userEvent, within} from 'storybook/test';
import {
  WorkflowDefinitionsTable,
  type WorkflowDefinitionsTableProps,
} from './workflow-definitions-table.js';

const definitions: Definition[] = [
  createDefinition({
    id: 'deploy-production',
    name: 'Deploy production',
    configPath: '.shipfox/workflows/deploy.yml',
    updatedAt: '2026-09-18T18:15:00.000Z',
  }),
  createDefinition({
    id: 'nightly-verification',
    name: 'Nightly verification',
    configPath: '.shipfox/workflows/nightly.yml',
    updatedAt: '2026-09-17T06:30:00.000Z',
  }),
  createDefinition({
    id: 'manual-release',
    name: 'Manual release',
    configPath: null,
    source: 'manual',
    updatedAt: '2026-09-16T12:00:00.000Z',
  }),
];

const sync: DefinitionSyncSummary = {
  ref: 'main',
  status: 'succeeded',
  lastSyncAt: '2026-09-18T18:15:00.000Z',
  startedAt: '2026-09-18T18:14:58.000Z',
  finishedAt: '2026-09-18T18:15:00.000Z',
  lastErrorCode: null,
  lastErrorMessage: null,
  diagnostics: [],
};

const defaultArgs = {
  definitions,
  hasNextPage: false,
  isError: false,
  isFetchNextPageError: false,
  isFetchingNextPage: false,
  isPending: false,
  isRefreshing: false,
  onLoadMore: () => undefined,
  onOpenDefinition: () => undefined,
  onRetry: () => undefined,
  onRun: () => undefined,
  runError: null,
  runningDefinitionId: null,
  sync,
} satisfies WorkflowDefinitionsTableProps;

const meta = {
  title: 'Components/WorkflowDefinitionsTable',
  component: WorkflowDefinitionsTable,
  decorators: [
    (Story) => (
      <RelativeTimeProvider>
        <div className="w-[calc(100vw-32px)] max-w-920">
          <Story />
        </div>
      </RelativeTimeProvider>
    ),
  ],
  parameters: {layout: 'centered'},
  args: defaultArgs,
} satisfies Meta<typeof WorkflowDefinitionsTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const DataStates: Story = {
  render: (args) => (
    <div className="grid grid-cols-1 gap-section">
      <WorkflowDefinitionsTable {...args} definitions={[]} isPending />
      <WorkflowDefinitionsTable {...args} definitions={[]} />
      <WorkflowDefinitionsTable {...args} definitions={[]} isError />
      <WorkflowDefinitionsTable {...args} isRefreshing />
    </div>
  ),
};

export const FilteredEmpty: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByRole('textbox', {name: 'Search workflows'}), 'no match');

    await expect(canvas.getByText('No matching workflows')).toBeVisible();
    await expect(canvas.getAllByRole('button', {name: 'Clear search'}).length).toBeGreaterThan(0);
  },
};

function createDefinition(
  overrides: Partial<Definition> & Pick<Definition, 'id' | 'name'>,
): Definition {
  return {
    id: overrides.id,
    projectId: 'project-id',
    configPath: overrides.configPath ?? '.shipfox/workflows/workflow.yml',
    source: overrides.source ?? 'vcs',
    sha: 'abc123',
    ref: 'main',
    name: overrides.name,
    workflowDocument: {},
    workflowModel: {},
    manualTrigger: {name: 'on_demand'},
    fetchedAt: '2026-09-18T18:15:00.000Z',
    createdAt: '2026-09-18T18:15:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-09-18T18:15:00.000Z',
    ...overrides,
  };
}
