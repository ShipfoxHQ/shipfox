import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Inspector,
  InspectorFact,
  InspectorFacts,
  InspectorHeader,
  InspectorTabs,
} from './inspector.js';

describe('Inspector', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  test('docks as a labelled aside with a close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Inspector label="Run inspector" onClose={onClose} presentation="docked">
        <InspectorHeader title="deploy-web" description="Run 1">
          <InspectorFacts>
            <InspectorFact icon={<span />}>main</InspectorFact>
          </InspectorFacts>
        </InspectorHeader>
      </Inspector>,
    );

    const aside = screen.getByRole('complementary', {name: 'Run inspector'});

    expect(aside.classList.contains('bg-background-inspector-base')).toBe(true);
    expect(screen.getByRole('heading', {level: 2, name: 'deploy-web'})).toBeTruthy();
    expect(screen.getByText('main').classList.contains('font-code')).toBe(true);
    await user.click(screen.getByRole('button', {name: 'Close inspector'}));
    expect(onClose).toHaveBeenCalledOnce();
  });

  test('opens as a modal sheet named by the header title', () => {
    render(
      <Inspector label="Step inspector" onClose={vi.fn()} presentation="sheet">
        <InspectorHeader title="Run tests" description="Attempt #1" />
      </Inspector>,
    );

    expect(screen.getByRole('dialog', {name: 'Run tests'})).toBeTruthy();
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  test('renders nothing docked while closed', () => {
    const {container} = render(
      <Inspector label="Run inspector" onClose={vi.fn()} open={false} presentation="docked">
        <InspectorHeader title="deploy-web" />
      </Inspector>,
    );

    expect(container.innerHTML).toBe('');
  });

  test('labels tabs with their item count', () => {
    render(
      <Inspector label="Run inspector" onClose={vi.fn()} presentation="docked">
        <InspectorTabs
          tabs={[
            {value: 'results', label: 'Results', count: 2, content: 'Outputs'},
            {value: 'cost', label: 'Cost', content: 'Cost'},
          ]}
        />
      </Inspector>,
    );

    expect(screen.getByRole('tab', {name: 'Results 2'})).toBeTruthy();
    expect(screen.getByRole('tab', {name: 'Cost'})).toBeTruthy();
  });
});
