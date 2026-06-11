# Shipfox API Auth

Shipfox API Auth provides the server-side auth module for Shipfox APIs. It owns user accounts, email verification, login, refresh sessions, password reset, password change, JWT auth, and its PostgreSQL tables.

## Example

Register the module with the API module runner:

```ts
import {authModule} from '@shipfox/api-auth';
import {createApp, listen} from '@shipfox/node-fastify';
import {initializeModules} from '@shipfox/node-module';

const {auth, routes} = await initializeModules({
  modules: [authModule],
});

await createApp({auth, routes});
await listen();
```

This adds:

- auth database migrations from `libs/api/auth/drizzle`
- the JWT auth method used by protected routes
- routes under `/auth`

## Setup

This package is private to the workspace. Add it to another workspace package with:

```json
{
  "dependencies": {
    "@shipfox/api-auth": "workspace:*"
  }
}
```

Required environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_JWT_SECRET` | none | Secret used to sign and verify access tokens. |
| `AUTH_JWT_EXPIRES_IN` | `15m` | Access token lifetime. |
| `AUTH_JOB_LEASE_TOKEN_SECRET` | none | Secret used to sign and verify job lease tokens. |
| `AUTH_JOB_LEASE_TOKEN_EXPIRES_IN` | `90m` | Job lease token lifetime. |
| `AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS` | `14` | Refresh token and cookie lifetime. |
| `AUTH_REFRESH_COOKIE_NAME` | `shipfox_refresh_token` | HTTP cookie name for refresh sessions. |
| `CLIENT_BASE_URL` | `http://localhost:3000` | Base URL used in email verification and password reset links. |
| `MAILER_TRANSPORT` | `console` | Mail transport. Set to `smtp` to send real mail. |
| `MAILER_FROM` | `noreply@shipfox.local` | Sender used by auth emails. |
| `SMTP_HOST` | none | Required when `MAILER_TRANSPORT=smtp`. |
| `SMTP_PORT` | `587` | SMTP server port. |
| `SMTP_USER` | none | Optional SMTP user. |
| `SMTP_PASSWORD` | none | Optional SMTP password. |

## Security model

The module issues two kinds of bearer token, both presented as
`Authorization: Bearer <token>`. Both are **stateless**: each is signed with
HMAC-SHA256 and verified by checking its signature and expiry alone, with no
database read on the request path. They differ in who they authenticate and what
they grant, and the stateless tradeoff is accepted for a different reason in each
case. Each is signed with its own dedicated secret, so neither token type can be
used in place of the other.

### User session token

- **Design:** a stateless session token. It carries the user's identity and
  current membership list in its claims so protected routes can authorize without
  a per-request user or membership lookup.
- **Audience:** signed-in users on first-party clients (web app, CLI).
- **Grants:** the user's own account routes and, downstream, any route that
  authorizes against the membership claims. Its scope is "this user, with these
  memberships" — never a single resource.
- **Lifecycle:**
  - *Emit* — issued on login, signup verification, and password reset.
  - *Exchange* — sent on each request; a longer-lived refresh session mints a
    fresh token when it expires.
  - *Store* — held in client memory only, never persisted to disk or local
    storage. Refresh sessions are stored server-side as hashes, never in raw form.
  - *Discard* — expires on its own (minutes, not hours); the refresh session is
    revoked on logout and on password change.
- **Tradeoff — stale memberships:** because memberships ride in the claims, a
  membership change only takes effect on the next refresh. Accepted because the
  token is short-lived, so the staleness window is bounded and a per-request
  membership read is avoided.

### Job lease token

A single-job **capability** token, not a session. It is the means by which a
runner proves it is the legitimate holder of one specific job while it reports
progress and drives that job to completion.

- **Scope — exactly one job.** The token authorizes action on the single job it
  names, for the runner holding it. It is **not** a runner identity, it is **not**
  workspace-wide, and it is **not** a substitute for the long-lived runner
  credential used to claim work in the first place. The surrounding identifiers it
  carries (run, workspace, the claiming runner) are context for consumers; they do
  not widen what the bearer may touch.
- **Trust boundary.** There is exactly one issuer: the scheduling side mints a
  lease only when a runner claims a job. Everything downstream only *verifies* — an
  in-process signature check, with no callback to the issuer. The runner, and the
  untrusted agent workload it hosts, never mints or modifies a token; it only
  presents the one it was handed.
- **Mechanics.** Signed with HMAC-SHA256 using a dedicated secret, separate from
  the user-session secret. Its claims name the job and its surrounding context and
  nothing more, and it carries a fixed audience so a token minted for one purpose
  cannot be replayed against another. It is short-lived (bounded in hours, not
  days). The signing secret is supplied through configuration, never embedded in
  code or committed. The raw token must **never** be written to logs, traces, or
  error payloads — there is no automatic redaction to fall back on.
- **Defense in depth — server state is the final authority.** A valid token is
  never sufficient on its own to advance work. Server-side job and step state is
  the ultimate gate: a report against work that has already reached a terminal
  state (finished, failed, or cancelled) is ignored, so a still-valid token cannot
  resurrect or re-drive a job that is already done. Cancellation flows the other
  way as well — the server can ask the runner to stop at any point, and that
  request rides on the response to each heartbeat rather than depending on the
  token.
- **Threat model.** A leaked or replayed token has a deliberately small blast
  radius: it grants action on one already-claimed job, and only until it expires.
  It cannot claim new work, impersonate a runner, or reach other workspaces. If the
  *signing secret* leaks, the response is to rotate it; rotation invalidates every
  live lease at once (they fail signature verification) and forces fresh claims.
  Isolating this secret from the user-session secret is what lets one be rotated
  without disrupting the other.
- **Tradeoff — no per-token revocation.** A single outstanding lease cannot be
  revoked on its own; it simply expires. The claiming runner's credential is not
  re-checked on each request, so a lease minted just before that credential is
  revoked stays usable until it expires. Accepted because access is bounded in both
  time (short lease) and scope (one job), keeping the blast radius small, and
  because a per-request check would sit on the hot progress-reporting path.
- **Guidelines for future changes.** Keep the authority narrow: do not add claims
  that grant access beyond the single job, keep the lifetime bounded, keep a single
  issuer, and keep every other side verify-only. If the no-revocation window ever
  proves too wide, the right fix is to bind the lease to live runner or job state —
  not to broaden what the token itself can authorize.

## Routes

All routes are mounted under `/auth`.

| Method | Path | Auth | Result |
| --- | --- | --- | --- |
| `POST` | `/signup` | none | Creates a user and sends an email verification link. |
| `POST` | `/verify-email/confirm` | none | Verifies email, returns an access token, and sets the refresh cookie. |
| `POST` | `/verify-email/resend` | none | Sends a new verification email when the account is eligible. |
| `POST` | `/login` | none | Returns an access token and sets the refresh cookie. |
| `POST` | `/refresh` | refresh cookie | Rotates the refresh token and returns a new access token. |
| `POST` | `/logout` | refresh cookie | Revokes the current refresh token and clears the cookie. |
| `GET` | `/me` | bearer token | Returns the signed-in user. |
| `POST` | `/change-password` | bearer token | Changes the password and revokes other refresh sessions. |
| `POST` | `/password-reset` | none | Sends a password reset email when the account is eligible. |
| `POST` | `/password-reset/confirm` | none | Sets a new password, returns an access token, and sets the refresh cookie. |

Protected routes use the `Authorization: Bearer <token>` header. The refresh flow uses an HTTP-only cookie on the `/auth` path.

> [!IMPORTANT]
> Refresh cookies are set with `secure: true`, `httpOnly: true`, and `sameSite: "lax"`. Local browser tests need HTTPS or a test path that handles secure cookies.

## API

The package exports the module entry point:

```ts
import {authModule} from '@shipfox/api-auth';
```

It also exports lower-level pieces for tests and advanced integration:

- `routes`: the `/auth` route group.
- `db` and `migrationsPath`: the Drizzle database handle and migration path.
- `createJwtAuthMethod()`: the Fastify auth method for user JWTs.
- `createLeaseTokenAuthMethod()`: the Fastify auth method for job lease tokens.
- `issueJobLeaseToken(claims)` / `verifyJobLeaseToken(token)`: mint and verify job lease tokens.
- `getClientContext(request)`: reads the authenticated user context from a Fastify request.
- Entity types: `User`, `UserStatus`, `RefreshToken`, `EmailVerification`, and `PasswordReset`.

## Data Model

The module creates tables with the `auth_` prefix:

- `auth_users`
- `auth_refresh_tokens`
- `auth_email_verifications`
- `auth_password_resets`

Passwords use Argon2id. Email verification tokens, password reset tokens, and refresh tokens are opaque tokens stored as hashes.

## Behavior Notes

- Signup sends a verification email and returns the new user.
- Login only succeeds for active users with verified email addresses.
- Refresh tokens rotate on each refresh.
- Password reset and email verification consume their tokens once.
- Password change revokes other refresh sessions. It keeps the current session when the current refresh cookie is valid.
- Password reset requests and verification resend requests do not reveal whether an account exists.

## Development

Run checks for this package:

```sh
turbo check --filter=@shipfox/api-auth
turbo type --filter=@shipfox/api-auth
turbo test --filter=@shipfox/api-auth
```

Tests use Vitest and a real PostgreSQL database. Start local services before running the test suite:

```sh
docker compose up -d
```

The test environment uses the `api_test` database and sets fake auth secrets in `test/env.ts`.

## License

MIT
