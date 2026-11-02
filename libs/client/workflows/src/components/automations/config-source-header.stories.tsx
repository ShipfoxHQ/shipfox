import type {DefinitionSyncSummary, ProjectConfig} from '@shipfox/client-projects';
import type {Meta, StoryObj} from '@storybook/react';
import {ConfigSourceHeader} from './config-source-header.js';

const linkedConfig: ProjectConfig = {
  source: {
    kind: 'linked',
    provider: 'github',
    connectionId: '33333333-3333-4333-8333-333333333333',
    externalRepositoryId: '918273645',
    owner: 'acme',
    name: 'payments',
    defaultBranch: 'main',
  },
  head: {ref: 'refs/heads/main', commit: '3f9a21c0d6e4b8a17c2e5f9d0b3a6c8e1f4d7a20'},
  historySupported: true,
};

const managedConfig: ProjectConfig = {
  ...linkedConfig,
  source: {
    ...linkedConfig.source,
    kind: 'managed',
    provider: 'managed',
    externalRepositoryId: 'managed:8b1f0c2e-5d7a-4c3b-9e6f-1a2b3c4d5e6f',
    owner: null,
    name: null,
  },
  historySupported: true,
};

function sync(
  status: DefinitionSyncSummary['status'],
  lastErrorCode: string | null = null,
): DefinitionSyncSummary {
  return {
    ref: 'main',
    status,
    lastSyncAt: '2026-10-31T18:15:00.000Z',
    startedAt: '2026-10-31T18:14:58.000Z',
    finishedAt: '2026-10-31T18:15:00.000Z',
    lastErrorCode,
    lastErrorMessage: null,
    diagnostics: [],
  };
}

const meta = {
  title: 'Components/ConfigSourceHeader',
  component: ConfigSourceHeader,
  decorators: [
    (Story) => (
      <div className="w-[calc(100vw-32px)] max-w-920">
        <Story />
      </div>
    ),
  ],
  args: {
    config: linkedConfig,
    isConfigPending: false,
    sync: sync('succeeded'),
    isSyncPending: false,
  },
} satisfies Meta<typeof ConfigSourceHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const States: Story = {
  render: (args) => (
    <div className="grid grid-cols-1 gap-section">
      <ConfigSourceHeader {...args} />
      <ConfigSourceHeader {...args} sync={sync('syncing')} />
      <ConfigSourceHeader {...args} sync={sync('failed', 'invalid-definition')} />
      <ConfigSourceHeader {...args} sync={sync('failed', 'no-workflow-files')} />
      <ConfigSourceHeader {...args} config={{...linkedConfig, head: null}} />
      <ConfigSourceHeader {...args} config={managedConfig} />
      <ConfigSourceHeader {...args} config={undefined} sync={undefined} />
      <ConfigSourceHeader {...args} config={undefined} isConfigPending isSyncPending />
    </div>
  ),
};
