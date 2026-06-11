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

## Auth methods

The module exposes two Fastify auth methods. Both read an HS256 token from the
`Authorization: Bearer <token>` header and verify it statelessly — signature and
expiry are checked, but the claims are trusted without a database read. They
differ in who they authenticate and what they grant access to, which is what
makes the stateless tradeoff acceptable in each case.

### User JWT (`createJwtAuthMethod`)

- **Design:** a stateless session token. Signed with `AUTH_JWT_SECRET`, it carries
  the user identity and membership list in its claims so protected routes can
  authorize without a per-request user/membership lookup.
- **Audience:** signed-in users on first-party clients (web app, CLI).
- **Grants access to:** the user's own account routes (`/me`, `/change-password`)
  and, downstream, any route that authorizes against the membership claims. Scope
  is "this user, with these memberships" — not a single resource.
- **Lifecycle:**
  - *Emit* — issued on login, signup verification, and password reset.
  - *Exchange* — sent as a bearer token on each request; the longer-lived refresh
    cookie mints a fresh access token via `/refresh`.
  - *Store* — held in client memory only, never persisted to disk or local
    storage; refresh tokens are stored server-side as hashes.
  - *Discard* — expires on its own (`AUTH_JWT_EXPIRES_IN`, 15m); the refresh
    session is revoked by `/logout` and by password change.
- **Tradeoff — stale memberships:** because memberships ride in the claims, a
  membership change only takes effect on the next refresh (≤15m). Accepted because
  the access token is short-lived, so the staleness window is bounded and a
  per-request membership read is avoided.

### Job lease token (`createLeaseTokenAuthMethod`)

- **Design:** a single-job capability token, not a session. Signed with a
  dedicated secret (`AUTH_JOB_LEASE_TOKEN_SECRET`) and a fixed audience, its claims
  (`jobId`, `runId`, `workspaceId`, `runnerTokenId`) describe exactly what the
  bearer may act on. The signed token is the sole authority.
- **Audience:** a runner process acting on behalf of one claimed job — machine to
  machine, never a logged-in user.
- **Grants access to:** only the runner-facing endpoints a runner uses to report
  status and drive orchestration over the lifecycle of the job named in `jobId`.
  The other ids are carried for consumers but do not widen access. Scope is "this
  one job," which is why no broader authorization check is needed.
- **Lifecycle:**
  - *Emit* — minted by Scheduling when a runner claims a job, not by a login flow.
  - *Exchange* — sent as a bearer token on every status-reporting and
    orchestration call for the lease's duration.
  - *Store* — held in the runner's memory only for the life of the job, never
    written to disk; not persisted server-side.
  - *Discard* — expires on its own (`AUTH_JOB_LEASE_TOKEN_EXPIRES_IN`, 90m); there
    is no explicit invalidation step.
- **Tradeoff — no revocation:** `runnerTokenId` is *not* checked against the
  runner-token table, so a lease minted just before its runner token is revoked
  stays usable until it expires (≤90m). Accepted because access is bounded both in
  time (short lease) and in scope (a single job), so the blast radius is small, and
  a per-request DB check would sit on the hot status-reporting path. Bind to runner
  status only if that window proves too wide.

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
