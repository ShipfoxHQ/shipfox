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
    'adopted-session-paused',
    'adopted-session-ended',
  ])('maps the %s code to friendly, subject-keyed copy', (code) => {
    const error = new ApiError({message: LEAKY_MESSAGE, code, status: 500});

    const copy = loadErrorCopy(error, {subject: SUBJECT});

    expect(copy.title).toBe("Couldn't load integrations");
    expect(copy.message.length).toBeGreaterThan(0);
  });

  it.each([
    ['adopted-session-paused', 'Renewal is paused. Focus this window to continue.'],
    [
      'adopted-session-ended',
      'The impersonated session ended. Return to the administrator session to continue.',
    ],
  ])('keeps %s copy calm and actionable', (code, message) => {
    const error = new ApiError({message: LEAKY_MESSAGE, code, status: 0});

    expect(loadErrorCopy(error, {subject: SUBJECT})).toEqual({
      title: "Couldn't load integrations",
      message,
    });
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
