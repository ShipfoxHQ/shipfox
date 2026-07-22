const {createEmailChallenge, getEmailChallengeContinuation} = await import(
  '@shipfox/api-email-challenges'
);

if (
  typeof createEmailChallenge !== 'function' ||
  typeof getEmailChallengeContinuation !== 'function'
) {
  throw new Error(
    'Packed email challenges package does not export retry-safe continuation contracts.',
  );
}
