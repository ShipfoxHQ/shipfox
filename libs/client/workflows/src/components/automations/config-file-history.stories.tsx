import type {ConfigCommit} from '@shipfox/client-projects';
import {Panel} from '@shipfox/react-ui/panel';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import type {Meta, StoryObj} from '@storybook/react';
import {ConfigFileHistory} from './config-file-history.js';

const NOW = Date.parse('2026-11-02T18:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function commit(
  oid: string,
  message: string,
  authorName: string,
  daysAgo: number,
  htmlUrl: string | null,
): ConfigCommit {
  return {
    oid,
    message,
    authorName,
    authoredAt: new Date(NOW - daysAgo * DAY).toISOString(),
    htmlUrl,
  };
}

function githubCommits(): ConfigCommit[] {
  return [
    [
      'e01b77a9c2d4f6081a3b5c7d9e1f2a4b6c8d0e1f',
      'Bump retry budget on implement gate',
      'Mira Okafor',
      1,
    ],
    ['c91e4d70a1b2c3d4e5f60718293a4b5c6d7e8f90', 'Pin the checkout action', 'Mira Okafor', 3],
    [
      '60ce9b1f2e3d4c5b6a79881726354a5b6c7d8e9f',
      'Run tests before opening the pull request',
      'Noé Charmet',
      7,
    ],
    ['3f9a21c0d6e4b8a17c2e5f9d0b3a6c8e1f4d7a20', 'Add Shipfox config', 'shipfox-ai[bot]', 9],
  ].map(([oid, message, author, daysAgo]) =>
    commit(
      oid as string,
      message as string,
      author as string,
      daysAgo as number,
      `https://github.com/acme/payments/commit/${oid}`,
    ),
  );
}

const meta = {
  title: 'Components/ConfigFileHistory',
  component: ConfigFileHistory,
  decorators: [
    (Story) => (
      <RelativeTimeProvider now={NOW}>
        <Panel className="w-[calc(100vw-32px)] max-w-920">
          <Story />
        </Panel>
      </RelativeTimeProvider>
    ),
  ],
  args: {
    path: '.shipfox/workflows/implement.yml',
    commits: githubCommits(),
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    onRetry: () => undefined,
    onLoadMore: () => undefined,
  },
} satisfies Meta<typeof ConfigFileHistory>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A linked project: each row opens the commit on GitHub. */
export const Playground: Story = {};

/** A managed project: rows stay plain, with no hover wash, until a diff view exists. */
export const Managed: Story = {
  args: {
    path: '.shipfox',
    commits: githubCommits().map((entry) => ({...entry, htmlUrl: null})),
  },
};

export const States: Story = {
  render: (args) => (
    <div className="flex flex-col divide-y divide-border-neutral-base">
      <ConfigFileHistory {...args} commits={[]} isPending />
      <ConfigFileHistory {...args} commits={[]} isError />
      <ConfigFileHistory {...args} commits={[]} />
      <ConfigFileHistory {...args} hasNextPage />
      <ConfigFileHistory {...args} hasNextPage isFetchNextPageError />
    </div>
  ),
};
