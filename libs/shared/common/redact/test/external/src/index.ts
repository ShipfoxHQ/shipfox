import {
  createRedactor,
  REDACTION_PLACEHOLDER,
  type Redactor,
  redactSecrets,
  redactSensitiveText,
  redactSensitiveUrl,
  redactUrlCredentials,
  type StructuredRedactionOptions,
  safeRedactionPrefixLength,
  secretWireForms,
  stripUrlCredentials,
} from '@shipfox/redact';

const options: StructuredRedactionOptions = {secrets: ['runtime-secret']};
const redactor: Redactor = createRedactor(options);
const redacted = redactor.redact({
  authorization: 'Bearer project-token',
  databaseUrl: 'postgres://user:runtime-secret@db.example/glint',
});

const results = {
  placeholder: REDACTION_PLACEHOLDER,
  prefixLength: safeRedactionPrefixLength('safe runtime-sec', ['runtime-secret']),
  secret: redactSecrets('token=runtime-secret', ['runtime-secret']),
  sensitiveText: redactSensitiveText('Cookie: session=secret'),
  sensitiveUrl: redactSensitiveUrl('https://objects.example/file?X-Amz-Signature=secret'),
  urlCredentials: redactUrlCredentials('clone https://user:password@example.com/repo'),
  strippedUrl: stripUrlCredentials('https://user:password@example.com/repo'),
  wireForms: secretWireForms('runtime-secret'),
};

if (
  JSON.stringify(redacted).includes('runtime-secret') ||
  !results.secret.includes(REDACTION_PLACEHOLDER) ||
  !results.sensitiveUrl.includes(REDACTION_PLACEHOLDER) ||
  !results.wireForms.includes('runtime-secret')
) {
  throw new Error('Public redaction helpers returned an unexpected result');
}
