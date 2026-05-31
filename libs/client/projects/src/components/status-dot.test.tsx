import {render} from '@testing-library/react';
import {StatusDot} from './status-dot.js';

describe('StatusDot', () => {
  test('renders aria-hidden so screen readers skip the decorative dot', () => {
    const {container} = render(<StatusDot variant="success" />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
  });

  test.each([
    ['neutral', 'bg-tag-neutral-icon'],
    ['info', 'bg-tag-blue-icon'],
    ['success', 'bg-tag-success-icon'],
    ['warning', 'bg-tag-warning-icon'],
    ['error', 'bg-tag-error-icon'],
  ] as const)('variant=%s applies %s token class', (variant, bgClass) => {
    const {container} = render(<StatusDot variant={variant} />);

    const dot = container.querySelector(`span.${bgClass}`);
    expect(dot).not.toBeNull();
  });

  test('renders a ping ring when pulse is set', () => {
    const {container} = render(<StatusDot variant="info" pulse />);

    expect(container.querySelector('.motion-safe\\:animate-ping')).not.toBeNull();
  });

  test('omits the ping ring when pulse is unset', () => {
    const {container} = render(<StatusDot variant="info" />);

    expect(container.querySelector('.motion-safe\\:animate-ping')).toBeNull();
  });
});
