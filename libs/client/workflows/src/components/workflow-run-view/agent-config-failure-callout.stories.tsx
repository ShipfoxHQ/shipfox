import {Code} from '@shipfox/react-ui';
import type {Meta, StoryObj} from '@storybook/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {within} from 'storybook/test';
import type {WorkflowAgentStepConfig, WorkflowStepError} from '#core/workflow-run.js';
import {AgentConfigFailureCallout} from './agent-config-failure-callout.js';

const WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';
const AGENT_PROVIDERS_LINK_NAME = 'Configure Agent Providers';

const config: WorkflowAgentStepConfig = {
  provider: 'anthropic',
  model: 'claude-opus-4-8',
  thinking: 'high',
};

const meta = {
  title: 'Workflows/RunView/AgentConfigFailureCallout',
  component: AgentConfigFailureCallout,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-560 bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
    (Story) => {
      const rootRoute = createRootRoute({component: Outlet});
      const storyRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => <Story />,
      });
      const agentProviderSettingsRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/workspaces/$wid/settings/agent-providers',
        component: () => null,
      });
      const router = createRouter({
        history: createMemoryHistory({initialEntries: ['/']}),
        routeTree: rootRoute.addChildren([storyRoute, agentProviderSettingsRoute]),
      });

      return <RouterProvider router={router} />;
    },
  ],
  args: {
    workspaceId: WORKSPACE_ID,
    config,
    error: makeError('provider_not_configured'),
  },
} satisfies Meta<typeof AgentConfigFailureCallout>;

export default meta;
type Story = StoryObj<typeof meta>;
type WorkflowAgentConfigIssueValue = NonNullable<WorkflowStepError['agentConfigIssue']>;

const errorCases: Array<{
  label: string;
  error: WorkflowStepError;
}> = [
  {label: 'Provider not configured', error: makeError('provider_not_configured')},
  {label: 'Credentials invalid', error: makeError('credentials_invalid')},
  {label: 'Provider unsupported', error: makeError('provider_unsupported')},
  {label: 'Model unavailable', error: makeError('model_unavailable')},
  {label: 'Step config invalid', error: makeError('step_config_invalid')},
  {
    label: 'Unknown config failure',
    error: {
      message: 'Agent configuration is invalid',
      exitCode: null,
      signal: undefined,
      reason: 'agent_config_invalid',
      agentConfigIssue: undefined,
      category: 'user',
    },
  },
];

export const Playground: Story = {};

export const ErrorVariants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-20">
      {errorCases.map((item) => (
        <div key={item.label} className="flex flex-col gap-8">
          <Code variant="label" className="text-foreground-neutral-subtle">
            {item.label}
          </Code>
          <AgentConfigFailureCallout {...args} error={item.error} />
        </div>
      ))}
    </div>
  ),
};

export const TestProviderNotConfigured: Story = {
  play: assertCallout('Configure credentials for anthropic', true),
};

export const TestProviderUnsupported: Story = {
  args: {
    error: makeError('provider_unsupported'),
  },
  play: assertCallout('Choose a supported agent provider', false),
};

function makeError(agentConfigIssue: WorkflowAgentConfigIssueValue): WorkflowStepError {
  return {
    message: 'Agent configuration is invalid',
    exitCode: null,
    signal: undefined,
    reason: 'agent_config_invalid',
    agentConfigIssue,
    category: 'user',
  };
}

function assertCallout(title: string, showsCta: boolean): Story['play'] {
  return async ({canvasElement}) => {
    const canvas = within(canvasElement);

    await canvas.findByText(title);
    const cta = canvas.queryByRole('link', {name: AGENT_PROVIDERS_LINK_NAME});
    if (showsCta) {
      await canvas.findByRole('link', {name: AGENT_PROVIDERS_LINK_NAME});
    } else if (cta !== null) {
      throw new Error(`Unexpected ${AGENT_PROVIDERS_LINK_NAME} CTA`);
    }
  };
}
