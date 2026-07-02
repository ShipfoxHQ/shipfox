import type {ModelProviderCatalogEntryDto} from '@shipfox/api-agent-dto';
import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import {ModelProviderUsageModal} from './model-provider-usage-modal.js';

interface ModelProviderUsageModalStoryProps {
  variant: 'anthropic' | 'long-list';
}

function ModelProviderUsageModalStory({variant}: ModelProviderUsageModalStoryProps) {
  const [open, setOpen] = useState(true);
  const entry = variant === 'long-list' ? longListEntry() : anthropicEntry();

  return (
    <div className="min-h-screen bg-background-neutral-background p-24">
      <ModelProviderUsageModal
        entry={entry}
        initialModel={entry.default_model}
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
