import {render, screen} from '@testing-library/react';
import {Footer} from './footer.js';

const OPERATIONAL_REGEX = /operational/i;

describe('Footer', () => {
  test('renders Docs and Support links; right side empty in v1', () => {
    render(<Footer />);

    expect(screen.getByRole('link', {name: 'Docs'})).toHaveAttribute(
      'href',
      'https://docs.shipfox.io',
    );
    expect(screen.getByRole('link', {name: 'Support'})).toHaveAttribute(
      'href',
      'mailto:support@shipfox.io',
    );
    // Status badge intentionally omitted in v1 (would lie about state).
    expect(screen.queryByText(OPERATIONAL_REGEX)).not.toBeInTheDocument();
  });
});
