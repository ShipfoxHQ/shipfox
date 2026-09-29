import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {PackageUpdate} from '#core/package-updates.js';
import {DefinitionPackagesPanel} from './definition-packages-panel.js';

const UPDATE_AVAILABLE = /Update available/u;
const UPGRADE_PROMPT =
  'Use Shipfox to upgrade the ticket-to-pr workflow in `.shipfox/workflows/ticket.yml` to 2.0.0.';

describe('DefinitionPackagesPanel', () => {
  test('renders nothing without packages', () => {
    const {container} = render(<DefinitionPackagesPanel updates={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  test('flags an action update that widens its permissions', () => {
    const update = createUpdate({
      kind: 'action',
      package: 'shipfox/github-labeler',
      version: '1.2.0',
      latest: '2.0.0',
      behind: true,
      bump: 'major',
      capabilityChange: true,
      steps: ['label.apply'],
    });

    render(<DefinitionPackagesPanel updates={[update]} />);

    expect(screen.getByText('Update available: 1.2.0 to 2.0.0')).toBeInTheDocument();
    expect(screen.getByText('Changes permissions')).toBeInTheDocument();
    expect(screen.getByText('Used in label.apply')).toBeInTheDocument();
    expect(screen.queryByText('Needs your input')).not.toBeInTheDocument();
  });

  test('asks for input on a major template update and copies its upgrade prompt', async () => {
    const user = userEvent.setup();
    const update = createUpdate({
      kind: 'template',
      package: 'shipfox/ticket-to-pr',
      version: '1.2.0',
      latest: '2.0.0',
      behind: true,
      bump: 'major',
      upgradePrompt: UPGRADE_PROMPT,
    });

    render(<DefinitionPackagesPanel updates={[update]} />);
    await user.click(
      screen.getByRole('button', {name: 'Copy upgrade prompt for shipfox/ticket-to-pr'}),
    );

    expect(screen.getByText('Needs your input')).toBeInTheDocument();
    expect(screen.queryByText('Changes permissions')).not.toBeInTheDocument();
    await expect(navigator.clipboard.readText()).resolves.toBe(UPGRADE_PROMPT);
  });

  test('shows the pinned version of a package that is up to date', () => {
    const update = createUpdate({
      kind: 'action',
      package: 'shipfox/linear-issue-context',
      version: '2.0.1',
      latest: '2.0.1',
    });

    render(<DefinitionPackagesPanel updates={[update]} />);

    expect(screen.getByText('2.0.1, the latest version')).toBeInTheDocument();
    expect(screen.queryByText(UPDATE_AVAILABLE)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Changelog'})).not.toBeInTheDocument();
  });
});

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
