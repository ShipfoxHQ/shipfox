import type {WorkflowDocument} from '@shipfox/workflow-document';
import {definitionTriggersFor} from './definition-triggers.js';

describe('definitionTriggersFor', () => {
  it('projects document triggers to the public outbox trigger DTO shape', () => {
    const document: WorkflowDocument = {
      name: 'CI',
      triggers: {
        push: {
          source: 'github',
          event: 'push',
          with: {branch: 'main'},
          filter: 'event.ref == "refs/heads/main"',
        },
      },
      jobs: {
        build: {
          steps: [{run: 'pnpm test'}],
        },
      },
    };

    const result = definitionTriggersFor(document);

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
    const document: WorkflowDocument = {
      name: 'Manual',
      triggers: {
        manual: {
          source: 'manual',
          event: 'fire',
        },
      },
      jobs: {
        run: {
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const result = definitionTriggersFor(document);

    expect(result).toEqual({
      manual: {
        source: 'manual',
        event: 'fire',
      },
    });
  });

  it('projects cron schedule and timezone to the public outbox trigger DTO shape', () => {
    const document: WorkflowDocument = {
      name: 'Nightly',
      triggers: {
        nightly: {
          source: 'cron',
          event: 'tick',
          schedule: '0 2 * * *',
          timezone: 'Europe/Paris',
        },
      },
      jobs: {
        run: {
          steps: [{run: 'echo ok'}],
        },
      },
    };

    const result = definitionTriggersFor(document);

    expect(result).toEqual({
      nightly: {
        source: 'cron',
        event: 'tick',
        schedule: '0 2 * * *',
        timezone: 'Europe/Paris',
      },
    });
  });

  it('returns an empty object when the document has no triggers', () => {
    const document: WorkflowDocument = {
      name: 'No triggers',
      jobs: {
        build: {
          steps: [{run: 'pnpm build'}],
        },
      },
    };

    const result = definitionTriggersFor(document);

    expect(result).toEqual({});
  });
});
