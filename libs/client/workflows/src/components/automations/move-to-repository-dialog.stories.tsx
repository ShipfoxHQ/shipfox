import {argosScreenshot} from '@argos-ci/storybook/vitest';
import {configureApiClient} from '@shipfox/client-api';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useMemo} from 'react';
import {expect, screen, userEvent, waitFor, within} from 'storybook/test';
import {MoveToRepositoryDialog} from './move-to-repository-dialog.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const LEGACY_RADIO_NAME = /acme\/legacy/;
const PAYMENTS_RADIO_NAME = /acme\/payments/;

function repository(name: string, externalRepositoryId: string, visibility: string) {
  return {
    connection_id: CONNECTION_ID,
    external_repository_id: externalRepositoryId,
    owner: 'acme',
    name,
    full_name: `acme/${name}`,
    default_branch: name === 'payments' ? 'main' : 'trunk',
    visibility,
    clone_url: `https://github.com/acme/${name}.git`,
    html_url: `https://github.com/acme/${name}`,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

async function respond(request: Request): Promise<Response> {
  const {pathname} = new URL(request.url);
  if (pathname === '/integration-connections') {
    return json({
      connections: [
        {
          id: CONNECTION_ID,
          workspace_id: WORKSPACE_ID,
          provider: 'github',
          external_account_id: '1001',
          slug: 'acme',
          display_name: 'acme',
          lifecycle_status: 'active',
          capabilities: ['source_control'],
          created_at: '2026-05-07T01:00:00.000Z',
          updated_at: '2026-05-07T01:00:00.000Z',
        },
      ],
    });
  }
  if (pathname === `/integration-connections/${CONNECTION_ID}/repositories`) {
    return json({
      repositories: [
        repository('legacy', '111', 'private'),
        repository('payments', '918273645', 'public'),
        repository('platform', '222', 'internal'),
      ],
      next_cursor: null,
    });
  }
  if (pathname === `/projects/${PROJECT_ID}/config/link`) {
    const body = (await request.clone().json()) as {external_repository_id: string};
    if (body.external_repository_id === '111') {
      return json({code: 'config-exists', message: 'The repository already has config'}, 409);
    }
    return json({
      status: 'ready',
      repository: {
        external_repository_id: body.external_repository_id,
        full_name: 'acme/payments',
        default_branch: 'main',
        visibility: 'public',
      },
      file_count: 4,
      pull_request: null,
    });
  }
  return json({code: 'not-found'}, 404);
}

function MoveToRepositoryDialogStory() {
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: (input) => respond(input as Request),
  });
  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
    [],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <MoveToRepositoryDialog
        projectId={PROJECT_ID}
        workspaceId={WORKSPACE_ID}
        workspaceSlug="acme"
        open
        onOpenChange={() => undefined}
      />
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Components/MoveToRepositoryDialog',
  component: MoveToRepositoryDialogStory,
  parameters: {layout: 'fullscreen'},
} satisfies Meta<typeof MoveToRepositoryDialogStory>;

export default meta;
type Story = StoryObj<typeof meta>;
type StoryContext = Parameters<NonNullable<Story['play']>>[0];

async function findDialog() {
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('radio', {name: PAYMENTS_RADIO_NAME});
  return dialog;
}

export const Playground: Story = {};

export const RepositoryRefused: Story = {
  play: async (ctx: StoryContext) => {
    const dialog = await findDialog();
    await userEvent.click(within(dialog).getByRole('radio', {name: LEGACY_RADIO_NAME}));
    await within(dialog).findByRole('alert');
    await expect(within(dialog).getByRole('button', {name: 'Continue'})).toBeDisabled();
    await argosScreenshot(ctx, 'Move To Repository Refused');
  },
};

export const Confirm: Story = {
  play: async (ctx: StoryContext) => {
    const dialog = await findDialog();
    await userEvent.click(within(dialog).getByRole('radio', {name: PAYMENTS_RADIO_NAME}));
    const continueButton = within(dialog).getByRole('button', {name: 'Continue'});
    await waitFor(() => expect(continueButton).toBeEnabled());
    await userEvent.click(continueButton);
    await within(dialog).findByRole('list', {name: 'What changes'});
    await argosScreenshot(ctx, 'Move To Repository Confirm');
  },
};
