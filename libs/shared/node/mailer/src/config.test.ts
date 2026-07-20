import nodemailer from 'nodemailer';

const loggerInfo = vi.hoisted(() => vi.fn());

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => ({info: loggerInfo}),
}));

describe('configured mailer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
    loggerInfo.mockClear();
  });

  test('uses the console mailer by default', async () => {
    vi.stubEnv('MAILER_TRANSPORT', 'console');

    const {mailer} = await import('./index.js');

    await mailer.send({to: 'alice@example.com', subject: 'Welcome', text: 'Hello Alice'});

    expect(loggerInfo).toHaveBeenCalledWith(
      {
        mailer: 'console',
        from: 'noreply@shipfox.local',
        to: 'alice@example.com',
        subject: 'Welcome',
        text: 'Hello Alice',
      },
      'mailer.send',
    );
  });

  test('creates an SMTP mailer from environment configuration', async () => {
    const sendMail = vi.fn().mockResolvedValue({messageId: '<test>'});
    const createTransportSpy = vi
      .spyOn(nodemailer, 'createTransport')
      // biome-ignore lint/suspicious/noExplicitAny: nodemailer transport type is heavy; cast for the test
      .mockReturnValue({sendMail} as any);
    vi.stubEnv('MAILER_TRANSPORT', 'smtp');
    vi.stubEnv('MAILER_FROM', 'support@shipfox.test');
    vi.stubEnv('SMTP_HOST', 'smtp.example.com');
    vi.stubEnv('SMTP_PORT', '465');
    vi.stubEnv('SMTP_USER', 'user');
    vi.stubEnv('SMTP_PASSWORD', 'pass');

    const {mailer} = await import('./index.js');

    await mailer.send({to: 'alice@example.com', subject: 'Welcome', text: 'Hello Alice'});

    expect(createTransportSpy).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: {user: 'user', pass: 'pass'},
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'support@shipfox.test',
      to: 'alice@example.com',
      subject: 'Welcome',
      text: 'Hello Alice',
      html: undefined,
    });
  });

  test('rejects SMTP configuration without a host', async () => {
    vi.stubEnv('MAILER_TRANSPORT', 'smtp');
    vi.stubEnv('SMTP_HOST', '');

    const mailerModule = import('./index.js');

    await expect(mailerModule).rejects.toThrow('SMTP_HOST is required when MAILER_TRANSPORT=smtp');
  });
});
