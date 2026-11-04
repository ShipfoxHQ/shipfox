import {ApiError} from '@shipfox/client-api';

export type ProjectAccessSaveError = {kind: 'forbidden'} | {kind: 'form'; message: string};

const MESSAGES: Record<string, string> = {
  'access-connection-invalid':
    'A connection in the list is no longer available. Remove it and save again.',
  'access-connection-duplicate': 'A connection is listed twice. Reload the page and try again.',
  'access-resource-kind-unsupported':
    "A connection in the list can't be limited to some repositories. Set it to All repositories.",
  'resource-not-found':
    'A selected repository is no longer visible to its connection. Remove it and save again.',
  'access-resource-scope-empty': 'Select at least one repository for each limited connection.',
  'access-limit-exceeded': 'A project can list up to 100 connections and 1,000 repositories.',
  'source-changed': "The project's config source changed. Reload the page and try again.",
  'rate-limited': 'The provider is limiting requests. Wait a moment and try again.',
  timeout: "The provider didn't answer in time. Try again.",
  'provider-unavailable': "The provider didn't answer. Try again.",
};

export function projectAccessSaveError(error: unknown): ProjectAccessSaveError {
  if (error instanceof ApiError) {
    if (error.status === 403) return {kind: 'forbidden'};
    const message = MESSAGES[error.code];
    if (message) return {kind: 'form', message};
  }
  return {kind: 'form', message: "Couldn't save access. The previous access still applies."};
}
