import {randomUUID} from 'node:crypto';
import type {SentryIssueWebhookDto} from '@shipfox/api-integration-sentry-dto';
import {db} from '#db/db.js';
import {sentryInstallations} from '#db/schema/installations.js';
import {sentryInstallationFactory} from '#test/index.js';
import {
  SentryConnectionNotFoundError,
  SentryInstallationDeletedError,
  SentryInstallationNotFoundError,
} from './errors.js';
import {handleSentryIssueEvent, normalizeSentryIssueAction} from './webhook.js';

function issuePayload(installationUuid: string): SentryIssueWebhookDto {
  return {
    action: 'created',
    installation: {uuid: installationUuid},
    data: {issue: {id: 'issue-1'}},
  };
}

describe('handleSentryIssueEvent', () => {
  beforeEach(async () => {
    await db().delete(sentryInstallations);
  });

  test('throws SentryInstallationNotFoundError for an unknown installation', async () => {
    const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
    const getIntegrationConnectionById = vi.fn();

    const run = handleSentryIssueEvent({
      tx: db(),
      deliveryId: randomUUID(),
      payload: issuePayload('unknown-uuid'),
      publishIntegrationEventReceived,
      getIntegrationConnectionById,
    });

    await expect(run).rejects.toBeInstanceOf(SentryInstallationNotFoundError);
    expect(getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  test('throws SentryInstallationDeletedError for a deleted installation', async () => {
    const installationUuid = randomUUID();
    await sentryInstallationFactory.create({installationUuid, status: 'deleted'});
    const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
    const getIntegrationConnectionById = vi.fn();

    const run = handleSentryIssueEvent({
      tx: db(),
      deliveryId: randomUUID(),
      payload: issuePayload(installationUuid),
      publishIntegrationEventReceived,
      getIntegrationConnectionById,
    });

    await expect(run).rejects.toBeInstanceOf(SentryInstallationDeletedError);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  test('throws SentryConnectionNotFoundError for a verified-but-unclaimed installation', async () => {
    const installationUuid = randomUUID();
    await sentryInstallationFactory.create({installationUuid, connectionId: null});
    const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
    const getIntegrationConnectionById = vi.fn();

    const run = handleSentryIssueEvent({
      tx: db(),
      deliveryId: randomUUID(),
      payload: issuePayload(installationUuid),
      publishIntegrationEventReceived,
      getIntegrationConnectionById,
    });

    await expect(run).rejects.toBeInstanceOf(SentryConnectionNotFoundError);
    expect(getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  test('throws SentryConnectionNotFoundError when the installation has no connection', async () => {
    const installationUuid = randomUUID();
    await sentryInstallationFactory.create({installationUuid});
    const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
    const getIntegrationConnectionById = vi.fn(() => Promise.resolve(undefined));

    const run = handleSentryIssueEvent({
      tx: db(),
      deliveryId: randomUUID(),
      payload: issuePayload(installationUuid),
      publishIntegrationEventReceived,
      getIntegrationConnectionById,
    });

    await expect(run).rejects.toBeInstanceOf(SentryConnectionNotFoundError);
    expect(getIntegrationConnectionById).toHaveBeenCalledTimes(1);
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
  });
});

describe('normalizeSentryIssueAction', () => {
  test('rewrites a legacy "ignored" action to "archived"', () => {
    const result = normalizeSentryIssueAction({action: 'ignored', data: {issue: {id: '1'}}});

    expect(result).toMatchObject({action: 'archived', data: {issue: {id: '1'}}});
  });

  test('leaves a known action untouched', () => {
    const result = normalizeSentryIssueAction({action: 'resolved'});

    expect(result).toMatchObject({action: 'resolved'});
  });

  test('passes through a non-object payload unchanged', () => {
    expect(normalizeSentryIssueAction(null)).toBeNull();
    expect(normalizeSentryIssueAction('nope')).toBe('nope');
  });
});
