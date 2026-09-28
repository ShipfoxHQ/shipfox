import {configureApiClient} from '@shipfox/client-api';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {McpSetup, McpSetupInstructions} from './mcp-setup.js';

describe('McpSetup', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test/proxy/', fetchImpl: vi.fn()});
  });

  test('copies a Cursor entry that points at the resolved API endpoint', async () => {
    const user = userEvent.setup();
    render(<McpSetup />);

    await user.click(screen.getByRole('tab', {name: 'Cursor'}));
    const instructions = screen.getByRole('tabpanel');
    await user.click(within(instructions).getByRole('button', {name: 'Copy Cursor configuration'}));

    expect(JSON.parse(await navigator.clipboard.readText())).toEqual({
      mcpServers: {shipfox: {url: 'https://api.example.test/proxy/mcp'}},
    });
    expect(within(instructions).getByText('.cursor/mcp.json')).toBeVisible();
  });

  test('copies a VS Code entry that points at the resolved API endpoint', async () => {
    const user = userEvent.setup();
    render(<McpSetup />);

    await user.click(screen.getByRole('tab', {name: 'VS Code'}));
    const instructions = screen.getByRole('tabpanel');
    await user.click(
      within(instructions).getByRole('button', {name: 'Copy VS Code configuration'}),
    );

    expect(JSON.parse(await navigator.clipboard.readText())).toEqual({
      servers: {shipfox: {type: 'http', url: 'https://api.example.test/proxy/mcp'}},
    });
    expect(within(instructions).getByText('.vscode/mcp.json')).toBeVisible();
  });

  test('renders the instructions without a heading for a host that frames them', () => {
    render(<McpSetupInstructions />);

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('https://api.example.test/proxy/mcp')).toBeVisible();
    expect(screen.getByRole('tab', {name: 'Claude Code'})).toBeVisible();
  });
});
