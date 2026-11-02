import {classifyProviderError} from './failures.js';

describe('classifyProviderError', () => {
  it.each([
    '429 rate limit exceeded',
    '529 overloaded',
    'HTTP 503 Service Unavailable',
    'OpenAI API error (503): Internal Server Error',
    'status: 502',
    'Rate limit reached for requests',
    'fetch failed',
    'read ECONNRESET',
    'Request timed out',
  ])('retries a transient failure: %s', (message) => {
    expect(classifyProviderError(message)).toMatchObject({
      code: 'provider_unavailable',
      retryable: true,
    });
  });

  it.each([
    '400 invalid request',
    '400 max_tokens must be at most 512',
    '401 invalid api key',
    'OpenAI API error (400): max_tokens must be at most 512',
    'prompt is 5000 tokens, over the 4096 limit',
  ])('fails a final error at once: %s', (message) => {
    expect(classifyProviderError(message)).toMatchObject({
      code: 'provider_error',
      retryable: false,
    });
  });
});
