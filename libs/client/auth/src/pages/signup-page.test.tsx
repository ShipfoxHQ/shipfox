import {configureApiClient} from '@shipfox/client-api';
import {act, fireEvent, screen} from '@testing-library/react';
import {pageUserFactory} from '#test/factories/user.js';
import {renderAuthPage} from '#test/pages.js';
import {jsonResponse} from '#test/utils.js';
import {SignupPage} from './signup-page.js';

const SUBMITTED_EMAIL_RE = /new@example.com/;
const RESEND_COUNTDOWN_RE = /^Resend in \d+s$/;

describe('SignupPage', () => {
  beforeEach(() => {
    vi.useRealTimers();
    configureApiClient({baseUrl: 'https://api.example.test', getAccessToken: undefined});
  });

  test('shows check-email state after success', async () => {
    const user = pageUserFactory.build({email: 'new@example.com', name: 'New User'});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(jsonResponse({user}, {status: 201}));
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Name'), {target: {value: 'New User'}});
    fireEvent.change(screen.getByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));

    expect(await screen.findByRole('heading', {name: 'Check your email'})).toBeInTheDocument();
    expect(screen.getByText(SUBMITTED_EMAIL_RE)).toBeInTheDocument();
    expect(screen.getByRole('button', {name: RESEND_COUNTDOWN_RE})).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', {name: 'Use another email'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Log in'})).toHaveAttribute('href', '/auth/login');
  });

  test('keeps credentials when switching to login', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: {value: 'existing@example.com'},
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: {value: 'long secure password'},
    });
    fireEvent.click(screen.getByRole('link', {name: 'Log in'}));

    expect(await screen.findByRole('heading', {name: 'Connect to Shipfox'})).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('existing@example.com');
    expect(screen.getByLabelText('Password')).toHaveValue('long secure password');
  });

  test('surfaces duplicate-email errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {code: 'email-already-exists', message: 'Email already exists'},
          {status: 409},
        ),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email already exists');
  });

  test('enables resend after the signup cooldown expires', async () => {
    vi.useFakeTimers({toFake: ['Date', 'setInterval', 'clearInterval']});
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const user = pageUserFactory.build({email: 'new@example.com', name: 'New User'});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(jsonResponse({user}, {status: 201}));
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));
    expect(await screen.findByRole('button', {name: RESEND_COUNTDOWN_RE})).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(screen.getByRole('button', {name: 'Resend verification email'})).not.toHaveAttribute(
      'aria-disabled',
    );
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  test('resends verification email and restarts cooldown from the server response', async () => {
    vi.useFakeTimers({toFake: ['Date', 'setInterval', 'clearInterval']});
    const user = pageUserFactory.build({email: 'new@example.com', name: 'New User'});
    const nextResendAvailableAt = new Date(Date.now() + 120_000).toISOString();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(jsonResponse({user}, {status: 201}))
      .mockResolvedValueOnce(
        jsonResponse({next_resend_available_at: nextResendAvailableAt}, {status: 200}),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));
    await screen.findByRole('heading', {name: 'Check your email'});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    fireEvent.click(screen.getByRole('button', {name: 'Resend verification email'}));

    expect(
      await screen.findByText('If another verification email can be sent, it will arrive shortly.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', {name: RESEND_COUNTDOWN_RE})).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('surfaces resend failures without leaving the check-email state', async () => {
    vi.useFakeTimers({toFake: ['Date', 'setInterval', 'clearInterval']});
    const user = pageUserFactory.build({email: 'new@example.com', name: 'New User'});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(jsonResponse({user}, {status: 201}))
      .mockResolvedValueOnce(
        jsonResponse({code: 'server-error', message: 'Server error'}, {status: 500}),
      );
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));
    await screen.findByRole('heading', {name: 'Check your email'});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    fireEvent.click(screen.getByRole('button', {name: 'Resend verification email'}));

    expect(await screen.findByText('Server error')).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Check your email'})).toBeInTheDocument();
  });

  test('returns to the signup form when choosing another email', async () => {
    const user = pageUserFactory.build({email: 'new@example.com', name: 'New User'});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({code: 'unauthorized', message: 'Unauthorized'}, {status: 401}),
      )
      .mockResolvedValueOnce(jsonResponse({user}, {status: 201}));
    configureApiClient({fetchImpl});

    renderAuthPage('/auth/signup', <SignupPage />);
    fireEvent.change(await screen.findByLabelText('Email'), {target: {value: 'new@example.com'}});
    fireEvent.change(screen.getByLabelText('Password'), {target: {value: 'long secure password'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create account'}));
    await screen.findByRole('heading', {name: 'Check your email'});
    fireEvent.click(screen.getByRole('button', {name: 'Use another email'}));

    expect(screen.getByRole('heading', {name: 'Create your Shipfox account'})).toBeInTheDocument();
  });
});
