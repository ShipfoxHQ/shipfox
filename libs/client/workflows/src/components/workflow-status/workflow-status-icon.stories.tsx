import type {RunStatusDto} from '@shipfox/api-workflows-dto';
import {Code, Text} from '@shipfox/react-ui';
import type {Meta, StoryObj} from '@storybook/react';
import {getWorkflowStatusVisual} from './status-visuals.js';
import {WorkflowStatusIcon} from './workflow-status-icon.js';

const statuses: RunStatusDto[] = ['pending', 'running', 'succeeded', 'failed', 'cancelled'];

const meta = {
  title: 'Workflows/StatusIcon',
  component: WorkflowStatusIcon,
  parameters: {layout: 'centered'},
  decorators: [
    (Story) => (
      <div className="bg-background-neutral-base p-24">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkflowStatusIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

// Every state in one row at both the surfaces' sizes, so the optical diameters can be
// compared at a glance: each shape must read as the same-size disc, and pending vs
// cancelled (the states that used to collapse) must be unmistakable. Argos captures
// this in light and dark.
export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-32">
      <Scale label="DAG node / run row — 14px" size={14} />
      <Scale label="Run-header pill — 12px (ripple off)" size={12} ripple={false} />
    </div>
  ),
};

// The node layout in miniature: the glyph leads, the mono job name is the anchor.
export const InContext: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-12">
      {statuses.map((status) => (
        <div
          key={status}
          className="flex w-208 items-center gap-8 rounded-8 border border-border-neutral-base bg-background-components-base px-10 py-7"
        >
          <WorkflowStatusIcon status={status} size={14} />
          <Code variant="label" bold className="truncate text-foreground-neutral-base">
            {status}-job
          </Code>
        </div>
      ))}
    </div>
  ),
};

function Scale({label, size, ripple}: {label: string; size: number; ripple?: boolean}) {
  return (
    <div className="flex flex-col gap-12">
      <Code variant="label" className="text-foreground-neutral-subtle">
        {label}
      </Code>
      <div className="flex items-start gap-32">
        {statuses.map((status) => (
          <div key={status} className="flex flex-col items-center gap-6">
            <WorkflowStatusIcon status={status} size={size} ripple={ripple} />
            <Text size="xs" className="text-foreground-neutral-muted">
              {getWorkflowStatusVisual(status).label}
            </Text>
          </div>
        ))}
      </div>
    </div>
  );
}
