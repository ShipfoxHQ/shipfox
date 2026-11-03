import {Panel} from '@shipfox/react-ui/panel';
import type {Meta, StoryObj} from '@storybook/react';
import {ConfigFileCode, ConfigFileNotice} from './config-file-content.js';

const IMPLEMENT_WORKFLOW = `name: implement
description: Turn a task into a tested pull request.

on:
  - source: manual

jobs:
  build:
    runs_on: [default]
    steps:
      - uses: checkout
      - id: implement
        agent:
          model: anthropic/claude-sonnet-5-5
          prompt:
            - file: prompts/implement.md
      - run: pnpm test
`;

const meta = {
  title: 'Components/ConfigFileContent',
  component: ConfigFileCode,
  decorators: [
    (Story) => (
      <Panel className="w-[calc(100vw-32px)] max-w-920">
        <Story />
      </Panel>
    ),
  ],
  args: {path: '.shipfox/workflows/implement.yml', content: IMPLEMENT_WORKFLOW},
} satisfies Meta<typeof ConfigFileCode>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** What takes the code's place when a file can't be shown. */
export const Notices: Story = {
  render: () => (
    <div className="flex flex-col divide-y divide-border-neutral-base">
      <ConfigFileNotice problem="too-large" />
      <ConfigFileNotice problem="not-text" />
      <ConfigFileNotice problem="symlink" />
      <ConfigFileNotice problem="submodule" />
      <ConfigFileNotice problem="not-found" />
      <ConfigFileNotice problem="read-failed" onRetry={() => undefined} />
    </div>
  ),
};
