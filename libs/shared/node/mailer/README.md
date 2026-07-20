# Shipfox Mailer

Small mailer interface for Shipfox Node packages. It supports SMTP delivery for production and a console mailer for local development and tests.

## What it does

- **`Mailer`**: Interface with one `send(message)` method.
- **`MailMessage`**: Message shape with `to`, `subject`, `text`, and optional `html`.
- **`mailer`**: Configured process-wide mailer that uses the environment variables below.
- **`createConsoleMailer(options)`**: Logs mail through the Shipfox logger and can capture messages in an array.
- **`createSmtpMailer(options)`**: Sends mail through `nodemailer`.

## Usage

```ts
import {mailer} from '@shipfox/node-mailer';

await mailer.send({
  to: 'user@example.com',
  subject: 'Verify your email',
  text: 'Open this link to verify your email.',
});
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAILER_TRANSPORT` | `console` | Mail transport. Set to `smtp` to send real mail. |
| `MAILER_FROM` | `noreply@shipfox.local` | Sender address shown on outgoing emails. |
| `SMTP_HOST` | none | Required when `MAILER_TRANSPORT=smtp`. |
| `SMTP_PORT` | `587` | SMTP server port. |
| `SMTP_USER` | none | Optional SMTP user. |
| `SMTP_PASSWORD` | none | Optional SMTP password. |

## Notes

- SMTP uses `secure: true` by default on port `465`.
- SMTP auth is only sent when both `user` and `password` are set.
- The console mailer is useful in tests because `capture` stores each message.

## Development

```sh
turbo check --filter=@shipfox/node-mailer
turbo type --filter=@shipfox/node-mailer
turbo test --filter=@shipfox/node-mailer
```

## License

MIT
