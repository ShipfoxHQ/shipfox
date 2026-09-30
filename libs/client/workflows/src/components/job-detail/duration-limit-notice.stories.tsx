import type {RequiredAction} from '@shipfox/policy-notice';
import type {Meta, StoryObj} from '@storybook/react';
import {expect, within} from 'storybook/test';
import type {JobExecution} from '#core/workflow-run.js';
import {toWorkflowJobExecutionModel} from '#test/fixtures/workflow-model-mapper.js';
import {workflowJobExecutionDto} from '#test/fixtures/workflow-run.js';
import {DurationLimitNotice} from './duration-limit-notice.js';

function cappedExecution(requiredAction?: RequiredAction): JobExecution {
  const execution = toWorkflowJobExecutionModel(workflowJobExecutionDto({status: 'running'}));
  execution.durationCapped = true;
  execution.durationNotice = {
    reason: 'job-duration-limit',
    message: 'This workspace runs jobs for at most 1 h, so the timeout of this job is capped.',
    ...(requiredAction ? {requiredAction} : {}),
  };
  return execution;
}

const meta = {
  title: 'Workflows/JobDetail/DurationLimitNotice',
  component: DurationLimitNotice,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-560 bg-background-neutral-base">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DurationLimitNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithBillingAction: Story = {
  args: {
    execution: cappedExecution({
      reason: 'add-credits',
      message: 'Add credits',
      url: '/settings/billing',
    }),
  },
  play: async ({canvasElement}) => {
    const link = await within(canvasElement).findByRole('link', {name: 'Add credits'});
    expect(link).toHaveAttribute('href', '/settings/billing');
  },
};

export const WithSupportAction: Story = {
  args: {
    execution: cappedExecution({
      reason: 'job-duration-limit',
      message: 'Contact us',
      url: 'mailto:support@shipfox.io',
      intent: 'contact-support',
    }),
  },
  play: async ({canvasElement}) => {
    const link = await within(canvasElement).findByRole('link', {name: 'Contact us'});
    expect(link).toHaveAttribute('href', 'mailto:support@shipfox.io');
  },
};

export const WithoutAction: Story = {
  args: {execution: cappedExecution()},
};
