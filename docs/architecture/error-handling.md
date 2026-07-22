# Error handling

This guide owns the current error model for backend code. Read it when you add a
domain error, call an external provider, translate a request failure, or report
an unexpected failure. Package READMEs own their public error-reporting APIs and
local constraints.

Keep each error clear. Keep each boundary small.
Use direct types. Keep client data safe.
Keep logs short. Keep tags small. Avoid raw input.
Log the cause. Name the task. Keep secrets out.

## Translate at boundaries

Let errors bubble until a boundary can add meaning. Do not catch an error only
to log it. The normal flow is:

```text
external system -> core or db typed error -> presentation ClientError -> global handler -> HTTP response
```

Domain and persistence code throw typed errors with no HTTP concerns. Define a
plain `Error` subclass in `core/errors.ts`. Give it a clear message and name.
Add public readonly context only when callers need it.

The layer that calls an external system catches SDK-specific failures. It
re-throws a typed error with a stable reason enum. Include bounded retry context
such as `retryAfterSeconds` for backpressure. Callers must not depend on an SDK
error shape.

## Turn known failures into client responses

The presentation boundary translates known errors to `ClientError`. Route
`errorHandler`s are the usual place. Re-throw unknown errors. The global handler
then logs and reports them.

```ts
errorHandler: (error) => {
  if (error instanceof WorkspaceNotFoundError)
    throw new ClientError('Workspace not found', 'not-found', {status: 404});
  throw error;
},
```

`ClientError` is the structured client response. Its stable kebab-case `code`
and optional snake_case `details` are safe for the client. Its `data` is for
logs only. Its `cause` preserves the original error for diagnostics. Map typed
provider reasons to a stable status and client code at this boundary.

The global Fastify handler is the final fallback. It sends recognized client and
validation failures as 4xx responses. It logs and reports unrecognized errors as
a 500 `server-error`. An error without a useful translation is opaque to the
client.

## Report unexpected failures once

The earliest boundary that owns an unexpected failure reports it. A catch that
continues must report the failure. It can instead return or persist a recognized
error. It can also explain why the failure is non-actionable. Log the error with
safe, bounded context before calling `reportError`. This keeps diagnostics when
Sentry is disabled.

Report unknown HTTP, startup, runtime, shutdown, lifecycle, dispatcher, outbox,
inter-module, Temporal, and best-effort cleanup failures. Do not report expected
client, validation, authentication, signature, known-domain, typed-provider,
rate-limit, expected-timeout, cancellation, idempotency, or already-reported
failures. Do not report metrics-recording failures.

Use bounded classifications such as boundary, operation, module, event type, or
outcome. Never attach request bodies, headers, cookies, tokens, or payloads.
Do not attach activity arguments or inter-module input and output either.

`@shipfox/node-error-monitoring` owns Sentry startup, duplicate suppression,
and its reporting API. Read its
[package README](../../libs/shared/node/error-monitoring/README.md) when using
or changing that package.
