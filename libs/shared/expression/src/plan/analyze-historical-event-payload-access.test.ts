import {analyzeHistoricalEventPayloadAccess} from './analyze-historical-event-payload-access.js';

describe('analyzeHistoricalEventPayloadAccess', () => {
  it('detects direct prior event payload access', () => {
    expect(analyzeHistoricalEventPayloadAccess('executions[0].events[0].data.action')).toEqual({
      accesses: [
        {
          kind: 'payload',
          root: 'executions',
          segments: [0, 'events', 0, 'data', 'action'],
          source: 'executions[0].events[0].data.action',
        },
      ],
    });
  });

  it('detects the persisted trigger_events spelling and indexed access', () => {
    expect(
      analyzeHistoricalEventPayloadAccess('executions[1].trigger_events[2].data["action"]'),
    ).toEqual({
      accesses: [
        {
          kind: 'payload',
          root: 'executions',
          segments: [1, 'trigger_events', 2, 'data', 'action'],
          source: 'executions[1].trigger_events[2].data["action"]',
        },
      ],
    });
  });

  it('keeps current execution payloads and historical metadata safe', () => {
    expect(
      analyzeHistoricalEventPayloadAccess(
        'execution.events[0].data.action == "opened" && executions[0].events[0].source == "github" && executions[0].status == "succeeded" && executions.size() > 0 && executions.all(e, e.status == "succeeded") && executions.all(e, e.events.all(event, event.source == "github"))',
      ),
    ).toEqual({accesses: []});
  });

  it('classifies dynamic access conservatively instead of treating it as safe', () => {
    expect(
      analyzeHistoricalEventPayloadAccess('executions[inputs.execution].events[0].data.action'),
    ).toEqual({
      accesses: [
        {
          kind: 'unknown',
          root: 'executions',
          reason: 'dynamic',
          source: 'executions[inputs.execution].events[0].data.action',
        },
      ],
    });
  });

  it.each([
    'size(executions[0].events[0].data)',
    'executions[0].events[0].data.size()',
  ])('detects payload access inside cardinality expressions: %s', (source) => {
    expect(analyzeHistoricalEventPayloadAccess(source)).toEqual({
      accesses: [
        {
          kind: 'payload',
          root: 'executions',
          segments: [0, 'events', 0, 'data'],
          source: 'executions[0].events[0].data',
        },
      ],
    });
  });

  it('detects comprehension-based payload access', () => {
    expect(
      analyzeHistoricalEventPayloadAccess(
        'executions.map(e, e.events.map(event, event.data.action))',
      ),
    ).toEqual({
      accesses: [
        {
          kind: 'payload',
          root: 'executions',
          segments: ['*', 'events', '*', 'data', 'action'],
          source: 'event.data.action',
        },
        {
          kind: 'unknown',
          root: 'executions',
          reason: 'dynamic',
          source: 'executions.map(e, e.events.map(event, event.data.action))',
        },
      ],
    });
  });

  it('detects broad historical execution and event references', () => {
    expect(analyzeHistoricalEventPayloadAccess('executions[0]')).toEqual({
      accesses: [
        {
          kind: 'payload',
          root: 'executions',
          segments: [0],
          source: 'executions[0]',
        },
      ],
    });

    expect(analyzeHistoricalEventPayloadAccess('executions[0].events')).toEqual({
      accesses: [
        {
          kind: 'payload',
          root: 'executions',
          segments: [0, 'events'],
          source: 'executions[0].events',
        },
      ],
    });
  });
});
