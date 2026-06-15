import {ApiError} from '@shipfox/client-api';
import {loadErrorCopy} from './load-error-copy.js';

const SUBJECT = 'integrations';

const LEAKY_MESSAGE =
  'Request failed due to a network error: GET http://localhost:16101/integration-connections?workspace_id=019ebad4-9da3';

describe('loadErrorCopy', () => {
  it.each([
    'network-error',
    'request-failed',
    'server-error',
    'unauthorized',
    'forbidden',
  ])('maps the %s code to friendly, subject-keyed copy', (code) => {
    const error = new ApiError({message: LEAKY_MESSAGE, code, status: 500});

    const copy = loadErrorCopy(error, {subject: SUBJECT});

    expect(copy.title).toBe("Couldn't load integrations");
    expect(copy.message.length).toBeGreaterThan(0);
  });

  it('falls back to a generic message for an unmapped ApiError code', () => {
    const error = new ApiError({message: LEAKY_MESSAGE, code: 'not-found', status: 404});

    const copy = loadErrorCopy(error, {subject: SUBJECT});

    expect(copy).toEqual({
      title: "Couldn't load integrations",
      message: 'Something went wrong. Check your connection and try again.',
    });
  });

  it('falls back to a generic message for a non-ApiError throw', () => {
    const error = new TypeError('Cannot read properties of undefined');

    const copy = loadErrorCopy(error, {subject: SUBJECT});

    expect(copy).toEqual({
      title: "Couldn't load integrations",
      message: 'Something went wrong. Check your connection and try again.',
    });
  });

  it('never leaks the raw error message or internal URL to the user', () => {
    const codes = ['network-error', 'request-failed', 'server-error', 'unauthorized', 'not-found'];

    const leaks = codes
      .map((code) => new ApiError({message: LEAKY_MESSAGE, code, status: 500}))
      .map((error) => loadErrorCopy(error, {subject: SUBJECT}))
      .filter((copy) => copy.message.includes('http') || copy.message === LEAKY_MESSAGE);

    expect(leaks).toEqual([]);
  });
});
