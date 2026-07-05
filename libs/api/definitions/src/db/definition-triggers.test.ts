import type {WorkflowModel, WorkflowModelTrigger} from '#core/entities/workflow-model.js';
import {definitionTriggersFor} from './definition-triggers.js';

function workflowModelWithTriggers(triggers: readonly WorkflowModelTrigger[]): WorkflowModel {
  return {
    kind: 'workflow',
    name: 'Test',
    triggers,
    jobs: [],
    dependencies: [],
  };
}

describe('definitionTriggersFor', () => {
  it('projects model triggers to the public outbox trigger DTO shape', () => {
    const model = workflowModelWithTriggers([
      {
        id: 'push',
        key: 'push',
        source: 'github',
        event: 'push',
        inputs: {branch: 'main'},
        filter: 'event.ref == "refs/heads/main"',
      },
    ]);

    const result = definitionTriggersFor(model);

    expect(result).toEqual({
      push: {
        source: 'github',
        event: 'push',
        with: {branch: 'main'},
        filter: 'event.ref == "refs/heads/main"',
      },
    });
    expect(result.push).not.toHaveProperty('on');
  });

  it('omits absent optional trigger fields', () => {
    const model = workflowModelWithTriggers([
      {
        id: 'manual',
        key: 'manual',
        source: 'manual',
        event: 'fire',
      },
    ]);

    const result = definitionTriggersFor(model);

    expect(result).toEqual({
      manual: {
        source: 'manual',
        event: 'fire',
      },
    });
  });

  it('projects cron config to the public outbox trigger DTO shape', () => {
    const model = workflowModelWithTriggers([
      {
        id: 'nightly',
        key: 'nightly',
        source: 'cron',
        event: 'tick',
        config: {
          schedule: '0 2 * * *',
          timezone: 'UTC',
        },
      },
    ]);

    const result = definitionTriggersFor(model);

    expect(result).toEqual({
      nightly: {
        source: 'cron',
        event: 'tick',
        config: {
          schedule: '0 2 * * *',
          timezone: 'UTC',
        },
      },
    });
  });

  it('returns an empty object when the model has no triggers', () => {
    const model = workflowModelWithTriggers([]);

    const result = definitionTriggersFor(model);

    expect(result).toEqual({});
  });
});
