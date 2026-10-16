import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {Meta, StoryObj} from '@storybook/react';
import {screen, waitFor} from 'storybook/test';
import {WorkflowSourceBreadcrumb} from './workflow-source-breadcrumb.js';
import {WorkflowSourceContent} from './workflow-source-content.js';

const COMPOSITE_FILE = './.shipfox/actions/pr-setup/action.yml';

const meta = {
  title: 'Workflows/SourceContent',
  component: WorkflowSourceContent,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className="flex h-screen bg-background-neutral-base">
        <Story />
      </div>
    ),
  ],
  args: {
    source: {
      format: 'yaml',
      content: `name: Set up a pull request review
inputs:
  base_sha:
    type: string
    required: true
outputs:
  changed_files:
    type: json
    value: \${{ steps.changed_files.outputs.files }}
steps:
  - key: install_mise
    uses: shipfox/setup-mise@1.2.0
  - key: changed_files
    name: List changed files
    run: \${{ action.path }}/scripts/changed-files.sh
    outputs:
      files: json`,
    },
    filename: COMPOSITE_FILE,
    highlightedLineRange: {startLine: 13, endLine: 17},
    breadcrumb: (
      <WorkflowSourceBreadcrumb
        callers={[
          {stepId: 'step-review', label: 'workflow.yaml:12-15'},
          {stepId: 'step-setup', label: './.shipfox/actions/review/action.yml:4-6'},
        ]}
        current={COMPOSITE_FILE}
        onSelectCaller={() => undefined}
      />
    ),
  },
} satisfies Meta<typeof WorkflowSourceContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CompositeActionFile: Story = {
  play: async (ctx) => {
    await screen.findByRole('navigation', {name: 'Source path'});
    await waitFor(
      () => {
        if (!document.querySelector('.shiki-override')?.textContent?.trim()) {
          throw new Error('Shiki highlighting has not rendered yet');
        }
      },
      {timeout: 10_000},
    );
    await document.fonts.ready;
    await argosScreenshot(ctx, 'Workflow Source Content Composite Action File');
  },
};
