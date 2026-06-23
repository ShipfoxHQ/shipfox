import {createConsoleMailer} from '#console-mailer.js';
import type {MailMessage} from '#mailer.js';

const loggerInfo = vi.hoisted(() => vi.fn());

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => ({info: loggerInfo}),
}));

describe('console mailer', () => {
  beforeEach(() => {
    loggerInfo.mockClear();
  });

  test('captures sent messages when capture array is provided', async () => {
    const capture: MailMessage[] = [];
    const mailer = createConsoleMailer({from: 'noreply@shipfox.test', capture});

    await mailer.send({
      to: 'alice@example.com',
      subject: 'Welcome',
      text: 'Hello Alice',
      html: '<p>Hello Alice</p>',
    });

    expect(capture).toHaveLength(1);
    expect(capture[0]).toEqual({
      to: 'alice@example.com',
      subject: 'Welcome',
      text: 'Hello Alice',
      html: '<p>Hello Alice</p>',
    });
  });

  test('logs the text body without the unreadable html body', async () => {
    const mailer = createConsoleMailer({from: 'noreply@shipfox.test'});

    await mailer.send({
      to: 'alice@example.com',
      subject: 'Welcome',
      text: 'Hello Alice',
      html: '<p>Hello Alice</p>',
    });

    expect(loggerInfo).toHaveBeenCalledWith(
      {
        mailer: 'console',
        from: 'noreply@shipfox.test',
        to: 'alice@example.com',
        subject: 'Welcome',
        text: 'Hello Alice',
      },
      'mailer.send',
    );
  });

  test('resolves successfully without capture array', async () => {
    const mailer = createConsoleMailer({from: 'noreply@shipfox.test'});

    await expect(
      mailer.send({to: 'alice@example.com', subject: 'Hi', text: 'Hi'}),
    ).resolves.toBeUndefined();
  });
});
