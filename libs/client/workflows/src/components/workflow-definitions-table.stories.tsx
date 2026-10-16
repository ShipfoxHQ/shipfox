import {ApiError} from '@shipfox/client-api';
import type {Definition, DefinitionSyncSummary} from '@shipfox/client-projects';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import type {Meta, StoryObj} from '@storybook/react';
import {runStartErrorCopy} from '#core/run-issue-copy.js';
import {
  WorkflowDefinitionsTable,
  type WorkflowDefinitionsTableProps,
} from './workflow-definitions-table.js';

const definitions: Definition[] = [
  createDefinition({
    id: 'deploy-production',
    name: 'Deploy production',
    configPath: '.shipfox/workflows/deploy.yml',
    updatedAt: '2026-09-18T18:15:00.000Z',
  }),
  createDefinition({
    id: 'nightly-verification',
    name: 'Nightly verification',
    configPath: '.shipfox/workflows/nightly.yml',
    updatedAt: '2026-09-17T06:30:00.000Z',
  }),
  createDefinition({
    id: 'manual-release',
    name: 'Manual release',
    configPath: null,
    source: 'manual',
    updatedAt: '2026-09-16T12:00:00.000Z',
  }),
];

const sync: DefinitionSyncSummary = {
  ref: 'main',
  status: 'succeeded',
  lastSyncAt: '2026-09-18T18:15:00.000Z',
  startedAt: '2026-09-18T18:14:58.000Z',
  finishedAt: '2026-09-18T18:15:00.000Z',
  lastErrorCode: null,
  lastErrorMessage: null,
  diagnostics: [],
};

const defaultArgs = {
  definitions,
  hasNextPage: false,
  isError: false,
  isFetchNextPageError: false,
  isFetchingNextPage: false,
  isPending: false,
  isRefreshing: false,
  onLoadMore: () => undefined,
  onOpenDefinition: () => undefined,
  onRetry: () => undefined,
  onRun: () => undefined,
  onDismissRunError: () => undefined,
  onRefreshDefinitions: () => undefined,
  readiness: new Map(),
  runError: null,
  runningDefinitionId: null,
  sync,
  workspaceSlug: 'acme',
} satisfies WorkflowDefinitionsTableProps;

const meta = {
  title: 'Components/WorkflowDefinitionsTable',
  component: WorkflowDefinitionsTable,
  decorators: [
    (Story) => (
      <RelativeTimeProvider>
        <div className="w-[calc(100vw-32px)] max-w-920">
          <Story />
        </div>
      </RelativeTimeProvider>
    ),
  ],
  parameters: {layout: 'centered'},
  args: defaultArgs,
} satisfies Meta<typeof WorkflowDefinitionsTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const DataStates: Story = {
  render: (args) => (
    <div className="grid grid-cols-1 gap-section">
      <WorkflowDefinitionsTable {...args} definitions={[]} isPending />
      <WorkflowDefinitionsTable {...args} definitions={[]} />
      <WorkflowDefinitionsTable {...args} definitions={[]} isError />
      <WorkflowDefinitionsTable {...args} isRefreshing />
      <WorkflowDefinitionsTable {...args} isError />
    </div>
  ),
};

export const NavigationStates: Story = {
  render: (args) => (
    <div className="grid grid-cols-1 gap-section">
      <WorkflowDefinitionsTable {...args} hasNextPage isFetchingNextPage />
      <WorkflowDefinitionsTable {...args} hasNextPage isFetchNextPageError />
      <WorkflowDefinitionsTable {...args} />
    </div>
  ),
};

function refusedStart(code: string, details: unknown) {
  return runStartErrorCopy(
    new ApiError({message: '', code, status: 422, details: {message: '', code, details}}),
  );
}

export const RefusedStart: Story = {
  render: (args) => (
    <div className="grid grid-cols-1 gap-section">
      <WorkflowDefinitionsTable
        {...args}
        runError={{
          definitionId: 'deploy-production',
          copy: refusedStart('workflow-interpolation-unresolvable', {
            variable_key: 'E2E_SCHEDULE_ENABLED',
            job_key: 'e2e',
            field: 'job.if',
          }),
        }}
      />
      <WorkflowDefinitionsTable
        {...args}
        runError={{
          definitionId: 'deploy-production',
          copy: refusedStart('secret-not-found', {key: 'DEPLOY_TOKEN'}),
        }}
      />
      <WorkflowDefinitionsTable
        {...args}
        runError={{
          definitionId: 'nightly-verification',
          copy: refusedStart('admission-denied', {
            reason: 'The monthly run allowance is used up.',
            required_action: {
              message: 'Run allowance reached',
              url: 'https://billing.example.test/upgrade',
            },
          }),
        }}
      />
      <WorkflowDefinitionsTable
        {...args}
        runError={{
          definitionId: 'manual-release',
          copy: refusedStart('manual-trigger-not-found', {}),
        }}
      />
      <WorkflowDefinitionsTable
        {...args}
        runError={{definitionId: 'deploy-production', copy: refusedStart('unknown', {})}}
      />
    </div>
  ),
};

export const NeedsSetup: Story = {
  args: {
    readiness: new Map([
      [
        'deploy-production',
        [
          {
            kind: 'variable-missing',
            key: 'DEPLOY_ENABLED',
            locations: [{jobKey: 'deploy', field: 'job.if'}],
            effect: 'blocks-start',
          },
          {
            kind: 'secret-missing',
            key: 'DEPLOY_TOKEN',
            locations: [{jobKey: 'deploy', field: 'env', envKey: 'TOKEN'}],
            effect: 'fails-job',
          },
        ],
      ],
      [
        'nightly-verification',
        [
          {
            kind: 'secret-missing',
            key: 'SLACK_TOKEN',
            locations: [{jobKey: 'notify', field: 'env', envKey: 'TOKEN'}],
            effect: 'fails-job',
          },
        ],
      ],
    ]),
  },
};

function createDefinition(
  overrides: Partial<Definition> & Pick<Definition, 'id' | 'name'>,
): Definition {
  return {
    id: overrides.id,
    projectId: 'project-id',
    configPath: overrides.configPath ?? '.shipfox/workflows/workflow.yml',
    source: overrides.source ?? 'vcs',
    sha: 'abc123',
    ref: 'main',
    name: overrides.name,
    workflowDocument: {},
    workflowModel: {},
    manualTrigger: {name: 'on_demand'},
    fetchedAt: '2026-09-18T18:15:00.000Z',
    createdAt: '2026-09-18T18:15:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-09-18T18:15:00.000Z',
    ...overrides,
  };
}
