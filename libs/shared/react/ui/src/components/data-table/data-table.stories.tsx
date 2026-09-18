import type {Meta, StoryObj} from '@storybook/react';
import {createColumnHelper, tableFeatures, useTable} from '@tanstack/react-table';
import type {ReactNode} from 'react';
import {StatusBadge} from '#components/badge/index.js';
import {Button} from '#components/button/index.js';
import {EmptyState} from '#components/empty-state/index.js';
import {Code, Text} from '#components/typography/index.js';
import {DataTable} from './data-table.js';

interface Workflow {
  id: string;
  name: string;
  path: string;
  status: 'Succeeded' | 'Running' | 'Failed';
  updatedAt: string;
}

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, Workflow>();

function statusVariant(status: Workflow['status']) {
  if (status === 'Succeeded') return 'success';
  if (status === 'Running') return 'info';
  return 'error';
}

const columns = columnHelper.columns([
  columnHelper.accessor('name', {
    header: 'Workflow',
    cell: ({getValue}) => <span className="font-medium">{getValue()}</span>,
  }),
  columnHelper.accessor('path', {
    header: 'Path',
    cell: ({getValue}) => <Code>{getValue()}</Code>,
  }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: ({getValue}) => {
      const status = getValue();
      return <StatusBadge variant={statusVariant(status)}>{status}</StatusBadge>;
    },
  }),
  columnHelper.accessor('updatedAt', {header: 'Updated'}),
  columnHelper.display({
    id: 'actions',
    header: 'Actions',
    cell: ({row}) => (
      <Button size="xs" variant="transparentMuted" aria-label={`Open ${row.original.name}`}>
        Open
      </Button>
    ),
  }),
]);

const workflows: Workflow[] = [
  {
    id: 'deploy-production',
    name: 'Deploy production',
    path: '.shipfox/workflows/deploy.yml',
    status: 'Succeeded',
    updatedAt: '2 minutes ago',
  },
  {
    id: 'nightly-verification',
    name: 'Nightly verification',
    path: '.shipfox/workflows/nightly.yml',
    status: 'Running',
    updatedAt: 'Now',
  },
  {
    id: 'release-candidate',
    name: 'Release candidate',
    path: '.shipfox/workflows/release-candidate-verification.yml',
    status: 'Failed',
    updatedAt: '18 minutes ago',
  },
];

interface WorkflowTableProps {
  className?: string;
  compact?: boolean;
  data?: Workflow[];
  emptyContent?: ReactNode;
  loading?: boolean;
  minimumWidth?: number;
  refreshing?: boolean;
  sticky?: boolean;
}

function WorkflowTable({
  className,
  compact = false,
  data = workflows,
  emptyContent,
  loading = false,
  minimumWidth,
  refreshing = false,
  sticky = false,
}: WorkflowTableProps) {
  const table = useTable({
    columns,
    data,
    features,
    getRowId: (workflow) => workflow.id,
  });

  return (
    <DataTable
      table={table}
      aria-label="Project workflows"
      className={className}
      density={compact ? 'compact' : 'default'}
      emptyContent={emptyContent}
      footer={
        <Text size="xs" className="text-foreground-neutral-muted">
          {loading ? 'Loading workflows' : `${data.length} workflows`}
        </Text>
      }
      isLoading={loading}
      isRefreshing={refreshing}
      loadingLabel="Loading workflows"
      minimumWidth={minimumWidth}
      stickyHeader={sticky}
      toolbar={
        <>
          <Text size="sm" className="font-medium">
            Workflows
          </Text>
          <Button size="sm" variant="secondary">
            New workflow
          </Button>
        </>
      }
    />
  );
}

const meta = {
  title: 'Components/DataTable',
  component: DataTable,
  tags: ['autodocs'],
  parameters: {layout: 'centered'},
} satisfies Meta<typeof DataTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <div className="w-[calc(100vw-32px)] max-w-920">
      <WorkflowTable />
    </div>
  ),
};

export const DataStates: Story = {
  render: () => (
    <div className="grid w-[calc(100vw-32px)] max-w-1120 grid-cols-1 gap-24 lg:grid-cols-2">
      <WorkflowTable data={[]} loading />
      <WorkflowTable refreshing />
      <WorkflowTable
        data={[]}
        emptyContent={
          <EmptyState
            icon="inboxLine"
            title="No workflows yet"
            description="Create a workflow to automate project work."
            variant="compact"
          />
        }
      />
      <WorkflowTable
        data={[]}
        emptyContent={
          <EmptyState
            tone="error"
            icon="errorWarningLine"
            title="Couldn't load workflows"
            description="Check your connection and try again."
            action={
              <Button size="sm" variant="secondary">
                Retry
              </Button>
            }
            variant="compact"
          />
        }
      />
    </div>
  ),
};

const scrollingStatuses: Workflow['status'][] = ['Succeeded', 'Running', 'Failed'];
const scrollingWorkflows: Workflow[] = Array.from({length: 12}, (_, index) => ({
  id: `workflow-${index}`,
  name: `Workflow ${String(index + 1).padStart(2, '0')}`,
  path: `.shipfox/workflows/workflow-${index + 1}.yml`,
  status: scrollingStatuses[index % scrollingStatuses.length] ?? 'Succeeded',
  updatedAt: `${index + 1} minutes ago`,
}));

export const Layouts: Story = {
  render: () => (
    <div className="flex w-[calc(100vw-32px)] max-w-920 flex-col gap-24">
      <div className="w-full max-w-520">
        <WorkflowTable minimumWidth={920} />
      </div>
      <WorkflowTable className="max-h-240" data={scrollingWorkflows} sticky />
      <WorkflowTable compact />
    </div>
  ),
};
