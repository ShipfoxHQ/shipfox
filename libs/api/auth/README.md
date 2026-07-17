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

Install the package from the registry:

```sh
pnpm add @shipfox/api-auth
```

Required environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_JWT_SECRET` | none | Secret used to sign and verify access tokens. |
| `AUTH_JWT_EXPIRES_IN` | `15m` | Access token lifetime. |
| `AUTH_JOB_LEASE_TOKEN_SECRET` | none | Secret used to sign and verify job lease tokens. |
| `AUTH_JOB_LEASE_TOKEN_EXPIRES_IN` | `90m` | Job lease token lifetime. |
| `AUTH_RUNNER_SESSION_TOKEN_SECRET` | none | Secret used to sign and verify runner session tokens. |
| `AUTH_RUNNER_SESSION_TOKEN_EXPIRES_IN` | `1h` | Runner session token lifetime. |
| `AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS` | `14` | Refresh token and cookie lifetime. |
| `AUTH_REFRESH_ROTATION_GRACE_SECONDS` | `30` | Grace window for accepting a just-rotated refresh token during concurrent refreshes. |
| `AUTH_REFRESH_COOKIE_NAME` | `shipfox_refresh_token` | HTTP cookie name for refresh sessions. |
| `AUTH_PASSWORD_ENABLED` | `true` | Enables password and email-verification routes. Set to `false` when another module provides login. Server construction fails if no login method is available. |
| `RATE_LIMIT_IDENTIFIER_SECRET` | none | Optional secret used to HMAC identifiers before storing rate-limit counters. When unset, the module derives a stable key from `AUTH_JWT_SECRET`. |
| `CLIENT_BASE_URL` | `http://localhost:5173` | Base URL used in email verification and password reset links. |
| `MAILER_TRANSPORT` | `console` | Mail transport. Set to `smtp` to send real mail. |
| `MAILER_FROM` | `noreply@shipfox.local` | Sender used by auth emails. |
| `SMTP_HOST` | none | Required when `MAILER_TRANSPORT=smtp`. |
| `SMTP_PORT` | `587` | SMTP server port. |
| `SMTP_USER` | none | Optional SMTP user. |
| `SMTP_PASSWORD` | none | Optional SMTP password. |

When `AUTH_PASSWORD_ENABLED=false`, the module does not register signup, login, password-reset, password-change, or email-verification routes. Refresh, logout, and current-session routes stay available. Another module must contribute a login method before the API server starts.

## Security model

The module issues three kinds of bearer token, all presented as
`Authorization: Bearer <token>`. All are **stateless**: each is signed with
HMAC-SHA256 and verified by checking its signature and expiry alone, with no
database read on the request path. They differ in who they authenticate and what
they grant, and the stateless tradeoff is accepted for a different reason in each
case. Each token class has a dedicated secret and audience, so one token type
cannot be used in place of another.

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

### Runner session token

A runner session token is the data-plane identity for a running manual runner.
The runner exchanges its long-lived registration token at startup, then uses the
short-lived session token to claim jobs. Heartbeat and step/report/log operations
use the per-job lease token instead.

- **Scope — one workspace's runner data plane.** The token names one runner
  session, one workspace, the fixed `workspace` scope, and the session's immutable
  label set. It can claim jobs for that workspace. It is not a user identity and
  does not authorize dashboard management routes.
- **Labels are self-attested.** A holder of a valid registration token chooses
  the labels it registers with. The labels are immutable after registration and
  signed into the session token, but they are not an authorization boundary in v1.
  Treat the registration token's workspace scope as the trust boundary.
- **Mechanics.** Signed with HMAC-SHA256 using `AUTH_RUNNER_SESSION_TOKEN_SECRET`
  and the `runner-session` audience. The default lifetime is `1h`, short enough
  to bound the residual claim window when a registration token is revoked.
- **Tradeoff — no per-session revocation in v1.** Claim stays stateless and does
  not check the runner session row on each poll. Revoking the registration token
  blocks new sessions, but an existing session can keep claiming until
  `AUTH_RUNNER_SESSION_TOKEN_EXPIRES_IN` elapses. A job execution claimed before
  session expiry then moves to the narrower job lease token path: heartbeat can
  renew that lease while server state still says the job execution is live, and
  cancellation or terminal job execution state is the revocation boundary for that
  already-claimed work.

### Job lease token

A single-job **capability** token, not a session. It is the means by which a
runner proves it is the legitimate holder of one specific job while it reports
progress and drives that job to completion.

- **Scope — exactly one job execution.** The token authorizes action on the
  single job execution it names, for the runner holding it. It is **not** a runner
  identity, it is **not** workspace-wide, and it is **not** a substitute for the
  long-lived runner credential used to claim work in the first place. The
  surrounding identifiers it carries (job, run, workspace, the claiming runner)
  are context for consumers; they do not widen what the bearer may touch. When a
  step is dispatched, the token may also carry the current step id and attempt so
  log append can verify signed membership in that one step attempt without
  querying workflow state.
- **Trust boundary.** There is exactly one issuer: the scheduling side mints a
  lease when a runner claims a job execution, next-step re-scopes it to the
  dispatched step attempt, and heartbeat re-mints the same narrow capability
  after server state accepts the heartbeat. Everything
  downstream only *verifies* — an in-process signature check, with no callback to
  the issuer. The runner, and the untrusted agent workload it hosts, never mints
  or modifies a token; it only presents the one it was handed.
- **Mechanics.** Signed with HMAC-SHA256 using a dedicated secret, separate from
  the user-session secret. Its claims name the job, job execution, and surrounding
  context and nothing more, and it carries a fixed audience so a token minted for
  one purpose cannot be replayed against another. It is short-lived (bounded in
  hours, not days), with heartbeat issuing a fresh short lease for the same live
  execution. The signing secret is supplied through configuration, never embedded
  in code or committed. The raw token must **never** be written to logs, traces, or
  error payloads — there is no automatic redaction to fall back on.
- **Defense in depth — server state is the final authority.** A valid token is
  never sufficient on its own to advance work. On the lease's own request path the
  gate is server-side step and progression state: a report against a step that has
  already reached a terminal state (finished, failed, or cancelled) is ignored, so
  a still-valid token cannot re-drive work that is already done. Job-level
  finalization is enforced outside the lease path. Cancellation flows the other way
  as well — the server can ask the runner to stop at any point, and that request
  rides on the response to each heartbeat rather than depending on the token.
- **Log append scope.** A step-scoped lease is a signed membership and attempt
  check for append-log authorization. It is not an active-step proof: until the
  runner adopts a later step-scoped token or the lease expires, the bearer can
  append to that step attempt's log stream. This is no broader than the job-scoped
  append authority it replaces, and step completion remains governed by
  server-side report/progression state.
- **Threat model.** A leaked or replayed token has a deliberately small blast
  radius: it grants action on one already-claimed job execution while that
  execution remains live. It cannot claim new work, impersonate a runner, or reach
  other workspaces. If the *signing secret* leaks, the response is to rotate it;
  rotation invalidates every live lease at once (they fail signature verification)
  and forces fresh claims. Isolating this secret from the user-session secret is
  what lets one be rotated without disrupting the other.
- **Tradeoff — no per-token revocation.** A single outstanding lease cannot be
  revoked on its own by token ID. The claiming runner's credential is not
  re-checked on each request, so a lease for already-claimed work can continue to
  be renewed by heartbeat until server state cancels, completes, times out, or
  otherwise terminates the job execution. Accepted because access is bounded in
  scope (one execution) and server state is checked on the hot path; a
  per-request credential lookup would sit on the hot progress-reporting path.
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
| `POST` | `/refresh` | refresh cookie | Rotates the refresh token when needed and returns a new access token. |
| `POST` | `/logout` | refresh cookie | Revokes the current refresh token and clears the cookie. |
| `GET` | `/me` | bearer token | Returns the signed-in user. |
| `POST` | `/change-password` | bearer token | Changes the password and revokes other refresh sessions. |
| `POST` | `/password-reset` | none | Sends a password reset email when the account is eligible. |
| `POST` | `/password-reset/confirm` | none | Sets a new password, returns an access token, and sets the refresh cookie. |

Protected routes use the `Authorization: Bearer <token>` header. The refresh flow uses an HTTP-only cookie on the `/auth` path.

When password login is disabled, the password and email-verification rows in this table return `404`. Refresh, logout, and `me` remain registered.

> [!IMPORTANT]
> Refresh cookies are set with `secure: true`, `httpOnly: true`, and `sameSite: "lax"`. Local browser tests need HTTPS or a test path that handles secure cookies.

### Rate limiting

The public auth endpoints include an application-layer abuse baseline for open source installs:

| Route | IP bucket | Email bucket |
| --- | --- | --- |
| `POST /auth/login` | 60 attempts per 5 minutes | 10 attempts per 15 minutes |
| `POST /auth/password-reset` | 30 email-send attempts per hour | 3 email-send attempts per hour |
| `POST /auth/verify-email/resend` | Shared with password reset | Shared with password reset |

Counters are stored in PostgreSQL as fixed windows in `auth_rate_limits`. IP addresses and email addresses are HMAC-SHA256 values before storage; raw identifiers are not persisted. `RATE_LIMIT_IDENTIFIER_SECRET` is optional. Set it when you want a dedicated HMAC secret, or leave it unset to derive the key from `AUTH_JWT_SECRET`.

The limiter uses `request.ip`, so production deployments behind a reverse proxy must configure the API app's `API_TRUST_PROXY` setting. Keep the default `false` when clients connect directly. Use a positive hop count such as `1`, or a trusted proxy IP/CIDR such as `10.0.0.0/8`, when proxy headers are controlled by infrastructure you operate.

This app-layer limiter protects semantic auth work such as Argon2 verification and email sending. It is not a volumetric DDoS control. Public production deployments should still use load balancer, CDN, WAF, or firewall rate limits at the network edge.

## API

The package exports the module entry point:

```ts
import {authModule} from '@shipfox/api-auth';
```

It also exports lower-level pieces for tests and advanced integration:

- `routes`: the `/auth` route group.
- `db` and `migrationsPath`: the Drizzle database handle and migration path.
- `createJwtAuthMethod()`: the Fastify auth method for user JWTs.
- `createRunnerSessionAuthMethod()`: the Fastify auth method for runner session tokens.
- `createLeaseTokenAuthMethod()`: the Fastify auth method for job lease tokens.
- `issueRunnerSessionToken(claims)` / `verifyRunnerSessionToken(token)`: mint and verify runner session tokens.
- `issueJobLeaseToken(claims)` / `verifyJobLeaseToken(token)`: mint and verify job lease tokens.
- `getClientContext(request)`: reads the authenticated user context from a Fastify request.
- Entity types: `User`, `UserStatus`, `RefreshToken`, `EmailVerification`, and `PasswordReset`.

### External identity callbacks

An external identity route can use these APIs to provision a user. It can then
create a normal Shipfox session and set its refresh cookie:

```ts
import {
  authCookiePlugin,
  createSessionForUser,
  provisionUser,
  setRefreshTokenCookie,
} from '@shipfox/api-auth';
import type {FastifyReply} from 'fastify';

export const callbackRoutePlugins = [authCookiePlugin];

export async function completeProviderCallback(
  reply: FastifyReply,
  profile: {email: string; name?: string},
): Promise<string> {
  const user = await provisionUser(profile);
  const session = await createSessionForUser({userId: user.id});

  setRefreshTokenCookie(reply, session.refreshToken);
  return session.token;
}
```

The provider must prove it owns `profile.email` before calling `provisionUser`.
For OAuth providers, require a verified-email claim such as `email_verified`.
`provisionUser` matches existing emails, and `createSessionForUser` can mint a
session for any active, verified account. An unverified provider email could
otherwise sign in as an existing password account with the same address.

Add `authCookiePlugin` to the callback route group before calling a cookie
helper. `getRefreshTokenCookie`, `setRefreshTokenCookie`, and
`clearRefreshTokenCookie` use the configured cookie name and the `/auth` path.

`provisionUser({email, name?})` uses the same email schema as the auth routes.
It makes an active, verified user with no password hash. If the email already
exists, it returns that user unchanged. It does not change the name, email,
status, verification state, or password. Repeated and concurrent callbacks are
safe.

This pre-verified user state lets an external login method create a session when password login and email-verification routes are disabled.

`createSessionForUser` accepts either a `userId` or an `email`. It only creates
a session for an active, verified user. It can throw `UserNotFoundError`,
`EmailNotVerifiedError`, `InvalidCredentialsError`, or
`AuthDependencyUnavailableError`. `CreateSessionForUserParams`,
`CreateSessionForUserResult`, and `CreateSessionForUserError` describe that
public contract.

`createJwtAuthMethod`, `createRunnerSessionAuthMethod`, and
`createLeaseTokenAuthMethod` make request-auth methods. They do not add a
user-facing login method.

## Data Model

The module creates tables with the `auth_` prefix:

- `auth_users`
- `auth_refresh_tokens`
- `auth_email_verifications`
- `auth_password_resets`
- `auth_rate_limits`

Passwords use Argon2id. Email verification tokens, password reset tokens, and refresh tokens are opaque tokens stored as hashes.

## Behavior Notes

- Signup sends a verification email and returns the new user.
- Login only succeeds for active users with verified email addresses and a password hash.
- Refresh tokens rotate on each refresh.
- Password reset and email verification consume their tokens once.
- Password change revokes other refresh sessions. It keeps the current session when the current refresh cookie is valid.
- Password reset requests and verification resend requests do not reveal whether an account exists.
- Login, password reset, and verification resend requests are rate-limited by IP address and email address.

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
