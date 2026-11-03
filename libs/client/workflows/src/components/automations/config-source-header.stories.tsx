import type {DefinitionSyncSummary, ProjectConfig} from '@shipfox/client-projects';
import {Text} from '@shipfox/react-ui/typography';
import type {Meta, StoryObj} from '@storybook/react';
import {ConfigSourceHeader, type ConfigSourceHeaderProps} from './config-source-header.js';

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
  move: null,
  pullRequest: null,
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

const PULL_REQUEST_URL = 'https://github.com/acme/payments/pull/128';

function move(
  status: 'linking' | 'linked',
  startedAgoMs: number,
): NonNullable<ProjectConfig['move']> {
  return {
    status,
    target: {
      connectionId: '33333333-3333-4333-8333-333333333333',
      externalRepositoryId: '918273645',
      fullName: status === 'linking' ? 'acme/payments' : null,
    },
    startedBy: '77777777-7777-4777-8777-777777777777',
    startedAt: new Date(Date.now() - startedAgoMs).toISOString(),
  };
}

const moveRunningConfig: ProjectConfig = {...managedConfig, move: move('linking', 20_000)};
const moveStoppedConfig: ProjectConfig = {...managedConfig, move: move('linking', 10 * 60_000)};

function movedConfig(state: NonNullable<ProjectConfig['pullRequest']>['state']): ProjectConfig {
  return {
    ...linkedConfig,
    head: {ref: 'refs/heads/main', commit: '8c41d2a7e9b03f5c6d1e2a4b7c9d0e3f5a6b8c1d'},
    move: move('linked', 5 * 60_000),
    pullRequest: {url: PULL_REQUEST_URL, number: 128, state},
  };
}

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
    moverName: null,
    onMove: () => undefined,
    onRetryMove: () => undefined,
    onOpenNewPullRequest: () => undefined,
    pendingAction: null,
    actionError: null,
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

interface SourceRow {
  label: string;
  props: Partial<ConfigSourceHeaderProps>;
}

/** Every row of the source header table in the product spec, in its order. */
const SOURCE_ROWS: SourceRow[] = [
  {label: 'Managed', props: {config: managedConfig, sync: sync('failed', 'no-workflow-files')}},
  {
    label: 'Move running, seen by a second member',
    props: {config: moveRunningConfig, moverName: 'Mira Okafor'},
  },
  {label: 'Move stopped', props: {config: moveStoppedConfig}},
  {
    label: 'Pull request open, while sync finds no workflow files',
    props: {config: movedConfig('open'), sync: sync('failed', 'no-workflow-files')},
  },
  {
    label: 'Pull request closed',
    props: {config: movedConfig('closed'), sync: sync('failed', 'no-workflow-files')},
  },
  {
    label: "Pull request state unknown, when GitHub doesn't answer",
    props: {config: movedConfig('unknown'), sync: sync('failed', 'no-workflow-files')},
  },
  {
    label: 'Merged, syncing',
    props: {config: {...movedConfig('merged'), pullRequest: null}, sync: sync('syncing')},
  },
  {label: 'Linked, healthy', props: {config: linkedConfig}},
  {
    label: 'Linked, sync failed',
    props: {config: linkedConfig, sync: sync('failed', 'invalid-definition')},
  },
];

function SourceRows({rows, args}: {rows: SourceRow[]; args: ConfigSourceHeaderProps}) {
  return (
    <div className="grid grid-cols-1 gap-region">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-inline">
          <Text size="xs" className="text-foreground-neutral-muted">
            {row.label}
          </Text>
          <ConfigSourceHeader {...args} {...row.props} />
        </div>
      ))}
    </div>
  );
}

export const MoveStates: Story = {
  render: (args) => <SourceRows rows={SOURCE_ROWS} args={args} />,
};

export const MoveActionStates: Story = {
  render: (args) => (
    <SourceRows
      args={args}
      rows={[
        {
          label: 'Retrying a stopped move',
          props: {config: moveStoppedConfig, pendingAction: 'retry'},
        },
        {
          label: 'Opening a new pull request',
          props: {config: movedConfig('closed'), pendingAction: 'open-pull-request'},
        },
        {
          label: 'Opening a new pull request refused',
          props: {
            config: movedConfig('closed'),
            actionError: {
              title: 'GitHub refused the pull request',
              message:
                'Give the Shipfox GitHub App write access to acme/payments in GitHub, then try again.',
            },
          },
        },
      ]}
    />
  ),
};
