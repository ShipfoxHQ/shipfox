# Email challenges

`@shipfox/api-email-challenges` provides server-side email ownership challenges.

## Create and recover a challenge

Call `createEmailChallenge` with a caller-generated `idempotencyKey`. The key is scoped to the supplied purpose and continuation. Retrying the same tuple returns the existing active challenge instead of creating another code.

If delivery fails after persistence, retrying may send a replacement code for the same challenge. Delivery can therefore occur more than once, but only the latest code remains valid.

```ts
const challenge = await createEmailChallenge({
  email,
  purpose: 'social-login',
  continuation,
  idempotencyKey,
  sourceIp,
});
```

Use `getEmailChallengeContinuation` after a lost response or browser refresh. It requires the same purpose, continuation, and idempotency key and returns only `expiresAt` and `nextResendAvailableAt`.

```ts
const timing = await getEmailChallengeContinuation({purpose, continuation, idempotencyKey});
```

The continuation read never returns an email address, code, proof, or delivery state. Missing, expired, terminal, and wrongly bound challenges return bounded `EmailChallengeError` outcomes.

## Lifecycle

Use `resendEmailChallenge`, `confirmEmailChallenge`, and `consumeEmailChallengeProof` with the original challenge handle. Existing resend limits, cooldowns, confirmation limits, proof-consumption semantics, and retention remain unchanged.
