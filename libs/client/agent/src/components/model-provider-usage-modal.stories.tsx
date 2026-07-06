import type {
  CustomModelProviderConfigDto,
  ModelProviderCatalogEntryDto,
} from '@shipfox/api-agent-dto';
import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import {ModelProviderUsageModal} from './model-provider-usage-modal.js';
import {
  usageTargetFromCatalogEntry,
  usageTargetFromCustomConfig,
} from './model-provider-usage-target.js';

interface ModelProviderUsageModalStoryProps {
  variant: 'anthropic' | 'custom' | 'long-list';
}

function ModelProviderUsageModalStory({variant}: ModelProviderUsageModalStoryProps) {
  const [open, setOpen] = useState(true);
  const entry = variant === 'long-list' ? longListEntry() : anthropicEntry();
  const target =
    variant === 'custom'
      ? usageTargetFromCustomConfig(customProviderConfig())
      : usageTargetFromCatalogEntry(entry);

  return (
    <div className="min-h-screen bg-background-neutral-background p-24">
      <ModelProviderUsageModal
        target={target}
        initialModel={target.default_model}
        workspaceDefaultHarnessId="claude"
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  );
}

const meta = {
  title: 'Agent/ProviderUsageModal',
  component: ModelProviderUsageModalStory,
  parameters: {layout: 'fullscreen'},
  args: {variant: 'anthropic'},
} satisfies Meta<typeof ModelProviderUsageModalStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const LongModelList: Story = {
  args: {variant: 'long-list'},
};

export const CustomProvider: Story = {
  args: {variant: 'custom'},
};

function anthropicEntry(): ModelProviderCatalogEntryDto {
  return {
    id: 'anthropic',
    label: 'Anthropic',
    support_status: 'supported',
    default_model: 'claude-opus-4-8',
    credential_fields: [{key: 'api_key', label: 'API key', secret: true}],
    unsupported_reason: null,
    models: [
      {id: 'claude-opus-4-8', label: 'Claude Opus 4.8'},
      {id: 'claude-sonnet-4-8', label: 'Claude Sonnet 4.8'},
      {id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5'},
    ],
  };
}

function longListEntry(): ModelProviderCatalogEntryDto {
  return {
    id: 'cloudflare-workers-ai',
    label: 'Cloudflare Workers AI',
    support_status: 'supported',
    default_model: '@cf/moonshotai/kimi-k2.7-code',
    credential_fields: [{key: 'api_token', label: 'API token', secret: true}],
    unsupported_reason: null,
    models: Array.from({length: 56}, (_, index) => ({
      id:
        index === 0
          ? '@cf/moonshotai/kimi-k2.7-code'
          : `provider/research-lab/model-family-${String(index).padStart(2, '0')}-large-context`,
      label: index === 0 ? 'Kimi K2.7 Code' : `Research Model ${index}`,
    })),
  };
}

function customProviderConfig(): CustomModelProviderConfigDto {
  return {
    kind: 'custom',
    provider_id: 'local-vllm',
    display_name: 'Local vLLM',
    api: 'openai-completions',
    base_url: 'http://localhost:8000/v1',
    headers: [],
    secret_header_names: [],
    models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
    default_model: 'llama-3.1',
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
  };
}
