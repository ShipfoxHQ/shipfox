import {render, screen} from '@testing-library/react';
import {Footer} from './footer.js';

const OPERATIONAL_REGEX = /operational/i;

describe('Footer', () => {
  test('renders Docs and Support links without a status badge', () => {
    render(<Footer />);

    expect(screen.getByRole('link', {name: 'Docs'})).toHaveAttribute(
      'href',
      'https://docs.shipfox.io',
    );
    expect(screen.getByRole('link', {name: 'Support'})).toHaveAttribute(
      'href',
      'mailto:support@shipfox.io',
    );
    // A status badge would imply live status, but the footer only has static links.
    expect(screen.queryByText(OPERATIONAL_REGEX)).not.toBeInTheDocument();
  });
});
