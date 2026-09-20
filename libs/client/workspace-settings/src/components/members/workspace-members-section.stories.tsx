import {configureApiClient} from '@shipfox/client-api';
import {type AuthState, authStateAtom} from '@shipfox/client-auth';
import {Toaster} from '@shipfox/react-ui/toast';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {Provider as JotaiProvider, useSetAtom} from 'jotai';
import {useEffect, useMemo} from 'react';
import {userEvent, within} from 'storybook/test';
import {WorkspaceMembersSettingsSection} from './workspace-members-section.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CURRENT_USER_ID = '22222222-2222-4222-8222-222222222222';

const authState: AuthState = {
  status: 'authenticated',
  token: 'storybook-token',
  user: {
    id: CURRENT_USER_ID,
    email: 'owner@example.com',
    emailVerifiedAt: '2026-07-01T00:00:00.000Z',
  },
  workspaces: [{id: WORKSPACE_ID, name: 'Acme', slug: 'acme', membershipId: 'membership-1'}],
};

const members = [
  {
    id: '55555555-5555-4555-8555-555555555551',
    user_id: CURRENT_USER_ID,
    workspace_id: WORKSPACE_ID,
    user_email: 'owner@example.com',
    user_name: 'Owner',
    created_at: '2026-07-03T00:00:00.000Z',
    updated_at: '2026-07-03T00:00:00.000Z',
  },
  {
    id: '55555555-5555-4555-8555-555555555552',
    user_id: '33333333-3333-4333-8333-333333333333',
    workspace_id: WORKSPACE_ID,
    user_email: 'alice@example.com',
    user_name: 'Alice',
    created_at: '2026-07-02T00:00:00.000Z',
    updated_at: '2026-07-02T00:00:00.000Z',
  },
  {
    id: '55555555-5555-4555-8555-555555555553',
    user_id: '44444444-4444-4444-8444-444444444444',
    workspace_id: WORKSPACE_ID,
    user_email: 'morgan@example.com',
    user_name: 'Morgan',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
  },
];

const invitations = [
  {
    id: '66666666-6666-4666-8666-666666666661',
    workspace_id: WORKSPACE_ID,
    email: 'new-hire@example.com',
    expires_at: '2026-08-03T00:00:00.000Z',
    accepted_at: null,
    invited_by_user_id: CURRENT_USER_ID,
    invited_by_display: 'Owner',
    created_at: '2026-07-03T00:00:00.000Z',
    updated_at: '2026-07-03T00:00:00.000Z',
  },
  {
    id: '66666666-6666-4666-8666-666666666662',
    workspace_id: WORKSPACE_ID,
    email: 'contractor@example.com',
    expires_at: '2026-08-02T00:00:00.000Z',
    accepted_at: null,
    invited_by_user_id: CURRENT_USER_ID,
    invited_by_display: 'Owner',
    created_at: '2026-07-02T00:00:00.000Z',
    updated_at: '2026-07-02T00:00:00.000Z',
  },
];

type Scenario = 'loaded' | 'empty' | 'loading';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
}

function fetchForScenario(scenario: Scenario): typeof fetch {
  return ((input: RequestInfo | URL) => {
    if (scenario === 'loading') return new Promise<Response>(() => undefined);
    const url =
      typeof input === 'object' && input !== null && 'url' in input ? input.url : String(input);
    const empty = scenario === 'empty';
    return Promise.resolve(
      url.endsWith('/members')
        ? jsonResponse({members: empty ? [] : members})
        : jsonResponse({invitations: empty ? [] : invitations}),
    );
  }) as typeof fetch;
}

function AuthSeed() {
  const setAuth = useSetAtom(authStateAtom);
  useEffect(() => {
    setAuth(authState);
  }, [setAuth]);
  return null;
}

function SectionStory({scenario}: {scenario: Scenario}) {
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: fetchForScenario(scenario)});
  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <AuthSeed />
        <div className="w-[900px] p-24">
          <WorkspaceMembersSettingsSection workspaceId={WORKSPACE_ID} workspaceName="Acme" />
        </div>
        <Toaster />
      </JotaiProvider>
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Workspace settings/Members',
  component: SectionStory,
  parameters: {layout: 'fullscreen'},
} satisfies Meta<typeof SectionStory>;

export default meta;
type Story = StoryObj<typeof SectionStory>;

export const Populated: Story = {
  args: {scenario: 'loaded'},
  play: async ({canvasElement}) => {
    await within(canvasElement).findByText('Alice');
    await within(canvasElement).findByText('new-hire@example.com');
  },
};

export const Empty: Story = {
  args: {scenario: 'empty'},
  play: async ({canvasElement}) => {
    await within(canvasElement).findByText('No members yet');
    await within(canvasElement).findByText('No pending invitations.');
  },
};

export const FilteredEmpty: Story = {
  args: {scenario: 'loaded'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await canvas.findByText('Alice');
    await userEvent.type(canvas.getByRole('textbox', {name: 'Search members'}), 'missing');
    await userEvent.type(
      canvas.getByRole('textbox', {name: 'Search pending invitations'}),
      'missing',
    );
    await canvas.findByText('No matching members');
    await canvas.findByText('No matching invitations');
  },
};

export const Loading: Story = {
  args: {scenario: 'loading'},
};
