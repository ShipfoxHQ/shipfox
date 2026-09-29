import type {Meta, StoryObj} from '@storybook/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {CallbackStatusShell} from '#components/callback-status-shell.js';

const outcomes = {
  connected: {
    title: 'Discord connected',
    status: 'success' as const,
    message: 'Discord is connected. Continue in integrations settings.',
  },
  reconnected: {
    title: 'Discord reconnected',
    status: 'success' as const,
    message: 'Discord is connected again. Continue in integrations settings.',
  },
  access_denied: {
    title: 'Discord access was not granted',
    message:
      'Discord did not grant access. This can happen if the person cancelled or the server install was not approved.',
    startOver: true,
  },
  'already-linked': {
    title: 'Discord server already linked',
    message: 'This Discord server is already linked to another workspace.',
  },
  'state-invalid': {
    title: 'Discord install link expired',
    message: 'Discord install link expired. Start again from workspace settings.',
    startOver: true,
  },
  'bot-not-in-guild': {
    title: 'Discord bot was not installed',
    message:
      'Shipfox could not find its bot in this server. Check that you have Manage Server permission and approve the install again.',
    startOver: true,
  },
  'provider-unavailable': {
    title: 'Discord is temporarily unavailable',
    message: 'Start a new install when Discord is available.',
    startOver: true,
  },
} as const;

type Outcome = keyof typeof outcomes;

function DiscordCallbackOutcome({outcome}: {outcome: Outcome}) {
  const rootRoute = createRootRoute({component: Outlet});
  const callbackRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/integrations/discord',
    component: () => (
      <CallbackStatusShell
        {...outcomes[outcome]}
        workspaceSlug="acme"
        installPath="/w/$workspaceSlug/integrations/discord"
      />
    ),
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: ['/w/acme/integrations/discord']}),
    routeTree: rootRoute.addChildren([callbackRoute]),
  });
  return <RouterProvider router={router} />;
}

const meta = {
  title: 'Integrations/Discord callback',
  component: DiscordCallbackOutcome,
  parameters: {layout: 'fullscreen'},
  args: {outcome: 'connected'},
  argTypes: {
    outcome: {control: 'select', options: Object.keys(outcomes)},
  },
} satisfies Meta<typeof DiscordCallbackOutcome>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CallbackOutcomes: Story = {};

export const Connected: Story = {args: {outcome: 'connected'}};
export const Reconnected: Story = {args: {outcome: 'reconnected'}};
export const AccessDenied: Story = {args: {outcome: 'access_denied'}};
export const AlreadyLinked: Story = {args: {outcome: 'already-linked'}};
export const StateInvalid: Story = {args: {outcome: 'state-invalid'}};
export const BotNotInGuild: Story = {args: {outcome: 'bot-not-in-guild'}};
export const ProviderUnavailable: Story = {args: {outcome: 'provider-unavailable'}};
