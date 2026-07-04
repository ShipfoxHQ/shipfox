import type {CustomModelProviderConfigDto} from '@shipfox/api-agent-dto';
import {configureApiClient} from '@shipfox/client-api';
import {Modal, ModalContent, ModalHeader, ModalTitle} from '@shipfox/react-ui/modal';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useMemo, useState} from 'react';
import {CustomModelProviderForm} from './custom-model-provider-form.js';

interface CustomModelProviderFormStoryProps {
  mode: 'create' | 'edit';
}

function CustomModelProviderFormStory({mode}: CustomModelProviderFormStoryProps) {
  const [open, setOpen] = useState(true);
  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
    [],
  );
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: () => Promise.resolve(new Response(JSON.stringify({models: []}))),
  });

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background-neutral-background p-24">
        <Modal open={open} onOpenChange={setOpen}>
          <ModalContent
            className="max-h-[min(760px,calc(100vh-32px))]"
            aria-describedby={undefined}
          >
            <ModalTitle className="sr-only">
              {mode === 'edit' ? 'Edit custom provider' : 'Add custom provider'}
            </ModalTitle>
            <ModalHeader title={mode === 'edit' ? 'Edit custom provider' : 'Add custom provider'} />
            <CustomModelProviderForm
              workspaceId="11111111-1111-4111-8111-111111111111"
              existingConfig={mode === 'edit' ? customConfig() : undefined}
              onSaved={() => setOpen(false)}
            />
          </ModalContent>
        </Modal>
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Agent/CustomProviderForm',
  component: CustomModelProviderFormStory,
  parameters: {layout: 'fullscreen'},
  args: {mode: 'create'},
} satisfies Meta<typeof CustomModelProviderFormStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const EditStoredSecrets: Story = {
  args: {mode: 'edit'},
};

function customConfig(): CustomModelProviderConfigDto {
  return {
    kind: 'custom',
    provider_id: 'local-vllm',
    display_name: 'Local vLLM',
    api: 'openai-completions',
    base_url: 'http://localhost:8000/v1',
    headers: [{name: 'x-region', value: 'us'}],
    secret_header_names: ['authorization'],
    models: [
      {
        id: 'llama-3.1',
        label: 'Llama 3.1',
        context_window: 128000,
        max_output_tokens: 16384,
      },
      {
        id: 'qwen-coder',
        label: 'Qwen Coder',
        context_window: 32768,
        max_output_tokens: 8192,
      },
    ],
    default_model: 'llama-3.1',
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
  };
}
