import {configureApiClient, resetApiClient} from '@shipfox/client-api';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import {type ReactNode, useEffect, useState} from 'react';
import {expect, userEvent, within} from 'storybook/test';
import {McpSetup} from './mcp-setup.js';

const ENDPOINT = 'https://api.example.test/mcp';

const withApiClient: Decorator = (Story) => (
  <ApiClientProvider>
    <Story />
  </ApiClientProvider>
);

function ApiClientProvider({children}: {children: ReactNode}) {
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    configureApiClient({baseUrl: 'https://api.example.test'});
    setConfigured(true);
    return () => {
      resetApiClient();
    };
  }, []);

  if (!configured) return null;
  return (
    <main className="min-h-screen bg-background-subtle-base p-frame">
      <div className="mx-auto max-w-[720px]">{children}</div>
    </main>
  );
}

const meta = {
  title: 'Shipfox MCP server/MCP setup',
  component: McpSetup,
  parameters: {layout: 'fullscreen'},
  decorators: [withApiClient],
} satisfies Meta<typeof McpSetup>;

export default meta;
type Story = StoryObj<typeof meta>;

async function openTab(canvasElement: HTMLElement, name: string) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('tab', {name}));
  return within(canvas.getByRole('tabpanel'));
}

export const ClaudeCode: Story = {
  play: async ({canvasElement}) => {
    const panel = await openTab(canvasElement, 'Claude Code');
    await expect(
      panel.getByText(`claude mcp add --transport http shipfox '${ENDPOINT}'`),
    ).toBeVisible();
  },
};

export const Codex: Story = {
  play: async ({canvasElement}) => {
    const panel = await openTab(canvasElement, 'Codex');
    await expect(
      panel.getByText(`codex mcp add shipfox --url '${ENDPOINT}'`, {exact: false}),
    ).toBeVisible();
  },
};

export const Cursor: Story = {
  play: async ({canvasElement}) => {
    const panel = await openTab(canvasElement, 'Cursor');
    await expect(panel.getByText('.cursor/mcp.json')).toBeVisible();
    await expect(panel.getByText(`"url": "${ENDPOINT}"`, {exact: false})).toBeVisible();
  },
};

export const VSCode: Story = {
  name: 'VS Code',
  play: async ({canvasElement}) => {
    const panel = await openTab(canvasElement, 'VS Code');
    await expect(panel.getByText('.vscode/mcp.json')).toBeVisible();
    await expect(panel.getByText(`"url": "${ENDPOINT}"`, {exact: false})).toBeVisible();
  },
};

export const ClaudeApp: Story = {
  play: async ({canvasElement}) => {
    const panel = await openTab(canvasElement, 'Claude app');
    await expect(panel.getByText('Settings → Connectors', {exact: false})).toBeVisible();
  },
};
