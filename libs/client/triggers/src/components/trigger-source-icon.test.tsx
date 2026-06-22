import {render} from '@testing-library/react';
import {getTriggerSourceIcon, TriggerSourceIcon} from './trigger-source-icon.js';

describe('getTriggerSourceIcon', () => {
  it('maps the system sources manual and cron to their own icons', () => {
    expect(getTriggerSourceIcon('manual')).toBe('cursorLine');
    expect(getTriggerSourceIcon('cron')).toBe('timeLine');
  });

  it('delegates integration sources to the integration catalog', () => {
    expect(getTriggerSourceIcon('github')).toBe('github');
    expect(getTriggerSourceIcon('sentry')).toBe('sentry');
  });

  it('falls back for unknown or empty sources', () => {
    expect(getTriggerSourceIcon('gitlab')).toBe('componentLine');
    expect(getTriggerSourceIcon('')).toBe('componentLine');
    expect(getTriggerSourceIcon(null)).toBe('componentLine');
    expect(getTriggerSourceIcon(undefined)).toBe('componentLine');
  });
});

describe('TriggerSourceIcon', () => {
  it('renders an accessible icon for a manual trigger', () => {
    const {getByLabelText} = render(<TriggerSourceIcon source="manual" aria-label="Manual" />);

    expect(getByLabelText('Manual')).toBeInTheDocument();
  });

  it('forwards class names so callers control sizing and color', () => {
    const {container} = render(
      <TriggerSourceIcon source="github" className="size-16 text-foreground-neutral-muted" />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('size-16', 'text-foreground-neutral-muted');
  });
});
