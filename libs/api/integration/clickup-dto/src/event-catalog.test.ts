import {integrationEventCatalogIssues} from '@shipfox/api-integration-core-dto';
import {clickupEventCatalog, clickupWebhookEventNames} from './index.js';

describe('clickupEventCatalog', () => {
  it('lists exactly the event names accepted by the webhook contract', () => {
    expect(clickupEventCatalog.events.map((event) => event.name)).toEqual([
      ...clickupWebhookEventNames,
    ]);
  });

  it('groups events by payload shape with a normalized schema per family', () => {
    expect(integrationEventCatalogIssues(clickupEventCatalog)).toEqual([]);
    expect(clickupEventCatalog.families.map((family) => family.key)).toEqual([
      'task',
      'task_deleted',
      'comment',
    ]);
    expect(
      clickupEventCatalog.events.filter((event) => event.family === 'comment').map((e) => e.name),
    ).toEqual(['taskCommentPosted', 'taskCommentUpdated']);
    expect(clickupEventCatalog.events.find((event) => event.name === 'taskDeleted')?.family).toBe(
      'task_deleted',
    );
  });
});
