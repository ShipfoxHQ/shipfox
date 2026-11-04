import {ApiError} from '@shipfox/client-api';
import {projectAccessSaveError} from './access-form-errors.js';

function apiError(status: number, code: string): ApiError {
  return new ApiError({message: code, code, status});
}

describe('projectAccessSaveError', () => {
  test('turns a refusal into the read-only state', () => {
    const result = projectAccessSaveError(apiError(403, 'forbidden'));

    expect(result).toEqual({kind: 'forbidden'});
  });

  test.each([
    ['access-connection-invalid', 'A connection in the list is no longer available'],
    ['access-connection-duplicate', 'A connection is listed twice'],
    ['access-resource-kind-unsupported', "can't be limited to some repositories"],
    ['resource-not-found', 'A selected repository is no longer visible'],
    ['access-resource-scope-empty', 'Select at least one repository'],
    ['access-limit-exceeded', 'up to 100 connections and 1,000 repositories'],
    ['source-changed', "The project's config source changed"],
    ['rate-limited', 'The provider is limiting requests'],
    ['timeout', "didn't answer in time"],
    ['provider-unavailable', "The provider didn't answer"],
  ])('explains %s', (code, message) => {
    const result = projectAccessSaveError(apiError(422, code));

    expect(result).toEqual({kind: 'form', message: expect.stringContaining(message)});
  });

  test('falls back for an unknown failure', () => {
    const result = projectAccessSaveError(new Error('boom'));

    expect(result).toEqual({
      kind: 'form',
      message: "Couldn't save access. The previous access still applies.",
    });
  });
});
