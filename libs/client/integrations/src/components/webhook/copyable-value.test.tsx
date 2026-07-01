// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {toast} from '@shipfox/react-ui';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {CopyableValue} from './copyable-value.js';

const WEBHOOK_URL = 'https://api.example.test/webhook/77777777-7777-4777-8777-777777777777';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CopyableValue', () => {
  test('keeps long values readable for manual selection', () => {
    render(<CopyableValue label="inbound URL" value={WEBHOOK_URL} />);

    const value = screen.getByText(WEBHOOK_URL);

    expect(value).toHaveClass('break-all');
    expect(value).not.toHaveClass('truncate');
  });

  test('shows an error toast when browser copy APIs fail', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText: vi.fn().mockRejectedValue(new Error('denied'))},
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id');
    render(<CopyableValue label="inbound URL" value={WEBHOOK_URL} />);

    fireEvent.click(screen.getByRole('button', {name: 'Copy inbound URL'}));

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Could not copy.'));
  });
});
