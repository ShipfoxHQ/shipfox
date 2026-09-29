import type {Meta, StoryObj} from '@storybook/react';
import {expect, userEvent, within} from 'storybook/test';
import type {PackageUpdate} from '#core/package-updates.js';
import {DefinitionPackagesPanel} from './definition-packages-panel.js';

const currentAction = createUpdate({
  kind: 'action',
  package: 'shipfox/linear-issue-context',
  version: '2.0.1',
  latest: '2.0.1',
  steps: ['triage.context'],
});

const outdatedAction = createUpdate({
  kind: 'action',
  package: 'shipfox/slack-thread-digest',
  version: '1.4.2',
  latest: '1.6.0',
  behind: true,
  bump: 'minor',
  steps: ['digest.summarize', 'digest.3'],
  changelog: [{version: '1.6.0', markdown: 'Adds the optional `max_messages` input.'}],
});

const permissionsAction = createUpdate({
  kind: 'action',
  package: 'shipfox/github-labeler',
  version: '1.2.0',
  latest: '2.0.0',
  behind: true,
  bump: 'major',
  capabilityChange: true,
  steps: ['label.apply'],
  changelog: [
    {version: '2.0.0', markdown: 'Applies labels to the pull request. Needs write access.'},
  ],
});

const outdatedTemplate = createUpdate({
  kind: 'template',
  package: 'shipfox/ticket-to-pr',
  version: '1.2.0',
  latest: '1.3.0',
  behind: true,
  bump: 'minor',
  changelog: [
    {
      version: '1.3.0',
      markdown:
        '### Added\n\n- A `pr_mode` option to open ready pull requests.\n- Jira as a tracker.',
    },
  ],
  upgradePrompt:
    'Use Shipfox to upgrade the ticket-to-pr workflow in `.shipfox/workflows/ticket.yml` to 1.3.0.',
});

const majorTemplate = createUpdate({
  kind: 'template',
  package: 'shipfox/fix-dependency-ci',
  version: '1.0.0',
  latest: '2.1.0',
  behind: true,
  bump: 'major',
  upgradePrompt:
    'Use Shipfox to upgrade the fix-dependency-ci workflow in `.shipfox/workflows/deps.yml` to 2.1.0.',
});

const meta = {
  title: 'Workflows/DefinitionPackagesPanel',
  component: DefinitionPackagesPanel,
  decorators: [
    (Story) => (
      <div className="w-[calc(100vw-32px)] max-w-[512px]">
        <Story />
      </div>
    ),
  ],
  parameters: {layout: 'centered'},
  args: {updates: [outdatedTemplate, outdatedAction, currentAction]},
} satisfies Meta<typeof DefinitionPackagesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** Up to date, update available, changes permissions, needs your input, and a template prompt. */
export const States: Story = {
  args: {
    updates: [currentAction, outdatedAction, permissionsAction, outdatedTemplate, majorTemplate],
  },
};

export const TestChangelogOpen: Story = {
  args: {updates: [outdatedTemplate]},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', {name: 'Changelog'}));
    await expect(await canvas.findByText('Jira as a tracker.')).toBeVisible();
  },
};

function createUpdate(
  overrides: Partial<PackageUpdate> &
    Pick<PackageUpdate, 'kind' | 'package' | 'version' | 'latest'>,
): PackageUpdate {
  return {
    behind: false,
    bump: null,
    capabilityChange: false,
    steps: [],
    changelog: [],
    upgradePrompt: null,
    ...overrides,
  };
}
