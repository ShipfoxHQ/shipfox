import {render} from '@testing-library/react';
import {TriggerSourceIcon} from './trigger-source-icon.js';

describe('TriggerSourceIcon', () => {
  it('exposes a labeled icon to assistive tech when it is the sole identifier', () => {
    const {container} = render(
      <TriggerSourceIcon provider={null} source="manual" aria-label="Manual" />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-label', 'Manual');
    expect(svg).not.toHaveAttribute('aria-hidden');
  });

  it('hides the icon from assistive tech when marked decorative', () => {
    const {container} = render(<TriggerSourceIcon provider={null} source="manual" aria-hidden />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('forwards class names so callers control sizing and color', () => {
    const {container} = render(
      <TriggerSourceIcon
        provider="github"
        source="github_acme"
        className="size-16 text-foreground-neutral-muted"
      />,
    );

    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('size-16', 'text-foreground-neutral-muted');
  });
});
