import {Toaster} from '@shipfox/react-ui/toast';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';
import {useMemo} from 'react';
import {userEvent, within} from 'storybook/test';
import {VariableForm} from './variable-form.js';

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

const meta: Meta<typeof VariableForm> = {
  title: 'Secrets/VariableForm',
  component: VariableForm,
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

type Story = StoryObj<typeof VariableForm>;

export const Playground: Story = {};

export const Edit: Story = {
  args: {mode: 'edit', existingKey: 'LOG_LEVEL', existingValue: 'debug'},
};

export const SensitiveNameWarning: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Name'), 'MY_TOKEN');
  },
};
