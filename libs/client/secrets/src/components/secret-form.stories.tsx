import {Toaster} from '@shipfox/react-ui';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';
import {useMemo} from 'react';
import {userEvent, within} from 'storybook/test';
import {SecretForm} from './secret-form.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function Wrapper({children}: {children: ReactNode}) {
  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}}),
    [],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <div className="w-[520px] overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base">
        {children}
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}

const meta: Meta<typeof SecretForm> = {
  title: 'Secrets/SecretForm',
  component: SecretForm,
  args: {
    workspaceId: WORKSPACE_ID,
    mode: 'create',
    onSaved: () => undefined,
    onCancel: () => undefined,
  },
  decorators: [
    (Story) => (
      <Wrapper>
        <Story />
      </Wrapper>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof SecretForm>;

export const Playground: Story = {};

export const Edit: Story = {
  args: {mode: 'edit', existingKey: 'API_TOKEN'},
};

export const ShortValueWarning: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Value'), 'abc');
  },
};
