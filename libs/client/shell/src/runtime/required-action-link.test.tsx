import type {RequiredAction} from '@shipfox/policy-notice';
import {render, screen} from '@testing-library/react';
import type {PropsWithChildren} from 'react';
import {
  ChromeProvider,
  type ChromeSlots,
  type RequiredActionIntentProps,
} from './chrome-context.js';
import {RequiredActionDefaultLink, RequiredActionLink} from './required-action-link.js';

function action(overrides: Partial<RequiredAction> = {}): RequiredAction {
  return {reason: 'limit', message: 'Add credits', url: '/billing', ...overrides};
}

function renderLink(
  requiredAction: RequiredAction,
  slot?: ChromeSlots['RequiredActionIntent'],
  appearance: 'button' | 'link' = 'button',
) {
  const chrome: ChromeSlots = {
    ProjectBreadcrumb: () => null,
    projectSlugResolver: async () => 'project',
    ...(slot ? {RequiredActionIntent: slot} : {}),
  };
  return render(<RequiredActionLink action={requiredAction} appearance={appearance} />, {
    wrapper: ({children}: PropsWithChildren) => (
      <ChromeProvider chrome={chrome}>{children}</ChromeProvider>
    ),
  });
}

describe('RequiredActionLink URL rule', () => {
  test('opens an application-relative path in the same tab', () => {
    renderLink(action({url: '/w/acme/billing?tab=credits'}));

    const link = screen.getByRole('link', {name: 'Add credits'});
    expect(link).toHaveAttribute('href', '/w/acme/billing?tab=credits');
    expect(link).not.toHaveAttribute('target');
  });

  test('opens an absolute URL on the application origin in the same tab', () => {
    const url = `${window.location.origin}/billing`;
    renderLink(action({url}));

    const link = screen.getByRole('link', {name: 'Add credits'});
    expect(link).toHaveAttribute('href', url);
    expect(link).not.toHaveAttribute('target');
  });

  test('opens another origin in a new tab without credentials', () => {
    renderLink(action({url: 'https://user:secret@billing.example/pay'}));

    const link = screen.getByRole('link', {name: 'Add credits'});
    expect(link).toHaveAttribute('href', 'https://billing.example/pay');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  });

  test('renders a mailto URL as a plain link', () => {
    renderLink(action({message: 'Contact us', url: 'mailto:support@shipfox.io'}));

    const link = screen.getByRole('link', {name: 'Contact us'});
    expect(link).toHaveAttribute('href', 'mailto:support@shipfox.io');
    expect(link).not.toHaveAttribute('target');
  });

  test.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    '//attacker.example/pay',
    'ftp://files.example/pay',
    'billing',
    '',
  ])('renders the message as text for %j', (url) => {
    renderLink(action({url}));

    expect(screen.getByText('Add credits')).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  test('renders without a chrome provider', () => {
    render(<RequiredActionLink action={action()} appearance="link" />);

    expect(screen.getByRole('link', {name: 'Add credits'})).toHaveAttribute('href', '/billing');
  });
});

describe('RequiredActionLink intent slot', () => {
  const contactSupport = action({
    message: 'Contact us',
    url: 'mailto:support@shipfox.io',
    intent: 'contact-support',
  });

  test('renders the slot for an action with an intent', () => {
    function Slot({action: {intent}, appearance}: RequiredActionIntentProps) {
      return (
        <button type="button">
          {intent} {appearance}
        </button>
      );
    }

    renderLink(contactSupport, Slot, 'link');

    expect(screen.getByRole('button', {name: 'contact-support link'})).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  test('renders the default link when the slot is unset', () => {
    renderLink(contactSupport);

    expect(screen.getByRole('link', {name: 'Contact us'})).toHaveAttribute(
      'href',
      'mailto:support@shipfox.io',
    );
  });

  test('does not call the slot for an action without an intent', () => {
    const Slot = vi.fn(() => <span>slot</span>);

    renderLink(action(), Slot);

    expect(Slot).not.toHaveBeenCalled();
    expect(screen.getByRole('link', {name: 'Add credits'})).toBeVisible();
  });

  test('passes the default link as the fallback for an intent the slot does not handle', () => {
    function Slot({action: {intent}, fallback}: RequiredActionIntentProps) {
      return intent === 'contact-support' ? <span>chat</span> : fallback;
    }

    renderLink(action({intent: 'retired-intent'}), Slot);

    expect(screen.getByRole('link', {name: 'Add credits'})).toHaveAttribute('href', '/billing');
  });

  test('renders the default link and reports the error when the slot throws', () => {
    const failure = new Error('Slot failed');
    const reportErrorSpy = vi.fn();
    vi.stubGlobal('reportError', reportErrorSpy);
    function Slot(): never {
      throw failure;
    }

    try {
      renderLink(contactSupport, Slot);

      expect(screen.getByRole('link', {name: 'Contact us'})).toHaveAttribute(
        'href',
        'mailto:support@shipfox.io',
      );
      expect(reportErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cause: failure,
          message: 'Failed to render required action intent.',
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('RequiredActionDefaultLink', () => {
  test('ignores the intent and reports a selection without preventing navigation', () => {
    const onSelect = vi.fn();
    render(
      <RequiredActionDefaultLink
        action={action({message: 'Contact us', url: 'mailto:support@shipfox.io', intent: 'x'})}
        appearance="button"
        onSelect={onSelect}
      />,
    );

    const link = screen.getByRole('link', {name: 'Contact us'});
    const notPrevented = link.dispatchEvent(
      new MouseEvent('click', {bubbles: true, cancelable: true}),
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(true);
  });
});
