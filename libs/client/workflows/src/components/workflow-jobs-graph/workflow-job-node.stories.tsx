import type {Meta, StoryObj} from '@storybook/react';
import type {KeyboardEventHandler} from 'react';
import type {WorkflowJobStatus} from '#core/workflow-run.js';
import {workflowJob} from '#test/fixtures/workflow-run.js';
import type {WorkflowJobGraphNode} from './graph-model.js';
import {WorkflowJobNode} from './workflow-job-node.js';

const statuses: WorkflowJobStatus[] = ['pending', 'running', 'succeeded', 'failed', 'cancelled'];
const ignoreKeyDown: KeyboardEventHandler<HTMLButtonElement> = () => undefined;
const storyNodes = [
  ...statuses.map((status, index) =>
    makeNode({
      id: `job-${status}`,
      label: `${status}-job`,
      status,
      position: index,
      dependencies: index === 0 ? [] : ['build'],
    }),
  ),
  makeNode({
    id: 'job-long-name',
    label: 'release-production-multi-region-with-canary-and-smoke-tests',
    status: 'pending',
    position: 5,
    dependencies: [],
  }),
  makeNode({
    id: 'job-multiple-dependencies',
    label: 'deploy',
    status: 'pending',
    position: 6,
    dependencies: ['build', 'lint'],
  }),
  makeNode({
    id: 'job-no-dependencies',
    label: 'manual-approval',
    status: 'succeeded',
    position: 7,
    dependencies: [],
  }),
];

const meta = {
  title: 'Workflows/JobNode',
  component: WorkflowJobNode,
  parameters: {layout: 'centered'},
  decorators: [
    (Story) => (
      <div className="bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkflowJobNode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllStatuses: Story = {
  render: () => (
    <div className="grid w-720 grid-cols-2 gap-12">
      {storyNodes.map((node) => (
        <WorkflowJobNode
          key={node.id}
          node={node}
          selected={node.status === 'running'}
          onSelect={() => undefined}
          onKeyDown={ignoreKeyDown}
        />
      ))}
    </div>
  ),
};

function makeNode({
  id,
  label,
  status,
  position,
  dependencies,
}: {
  id: string;
  label: string;
  status: WorkflowJobStatus;
  position: number;
  dependencies: string[];
}): WorkflowJobGraphNode {
  return {
    ...workflowJob({id, name: label, status, position, dependencies}),
    column: 0,
    row: position,
  };
}
