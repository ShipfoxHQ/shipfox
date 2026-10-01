import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {RUN_ISSUE_LOCATIONS_MAX} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {resolveTestAgentDefaults} from '#test/fixtures/agent-inter-module.js';
import {template} from '#test/helpers/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {cacheAgentDefaults, checkAgentConfigReadiness} from './agent-config-readiness.js';
import type {AgentDefaultsResolver} from './agent-defaults.js';

const refuseUnknownModel: AgentDefaultsResolver = (input) => {
  if (input.model === 'not-a-model') {
    throw createInterModuleKnownError(
      agentInterModuleContract.methods.resolveAgentConfig,
      'agent-config-invalid',
      {reason: 'model-unknown', model: input.model, provider: 'anthropic'},
    );
  }
  return resolveTestAgentDefaults(input);
};

describe('checkAgentConfigReadiness', () => {
  it('lists every step with the same cause once, with each place it is used', async () => {
    const model = workflowModel({
      jobs: {
        review: {
          steps: [
            {key: 'triage', model: 'not-a-model', prompt: 'Triage.'},
            {name: 'Fix', model: 'not-a-model', prompt: 'Fix.'},
          ],
        },
        verify: {steps: [{model: 'not-a-model', prompt: 'Verify.'}]},
      },
    });

    const issues = await checkAgentConfigReadiness({
      model,
      definitionId: 'def-1',
      resolveAgentDefaults: refuseUnknownModel,
    });

    expect(issues).toEqual([
      {
        kind: 'agent-config-invalid',
        reason: 'model-unknown',
        model: 'not-a-model',
        provider: 'anthropic',
        effect: 'blocks-start',
        locations: [
          {jobKey: 'review', step: {key: 'triage', index: 1}, field: 'agent.model'},
          {jobKey: 'review', step: {name: 'Fix', index: 2}, field: 'agent.model'},
          {jobKey: 'verify', step: {index: 1}, field: 'agent.model'},
        ],
      },
    ]);
  });

  it('caps the locations of an issue and counts the rest', async () => {
    const steps = Array.from({length: RUN_ISSUE_LOCATIONS_MAX + 2}, () => ({
      model: 'not-a-model',
      prompt: 'Review.',
    }));

    const issues = await checkAgentConfigReadiness({
      model: workflowModel({jobs: {review: {steps}}}),
      definitionId: 'def-1',
      resolveAgentDefaults: refuseUnknownModel,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.locations).toHaveLength(RUN_ISSUE_LOCATIONS_MAX);
    expect(issues[0]?.moreLocations).toBe(2);
  });

  it.each([
    ['model', {model: template('execution.events[0].data.model')}],
    ['provider', {model: 'not-a-model', provider: template('trigger.source')}],
    ['thinking', {model: 'not-a-model', thinking: template('run.name')}],
  ])('skips a step with a templated %s', async (_field, step) => {
    const resolveAgentDefaults = vi.fn(refuseUnknownModel);

    const issues = await checkAgentConfigReadiness({
      model: workflowModel({jobs: {review: {steps: [{prompt: 'Review.', ...step}]}}}),
      definitionId: 'def-1',
      resolveAgentDefaults,
    });

    expect(issues).toEqual([]);
    expect(resolveAgentDefaults).not.toHaveBeenCalled();
  });

  it('lets an error that is not a refusal through', async () => {
    const outage = new Error('agent module unavailable');

    await expect(
      checkAgentConfigReadiness({
        model: workflowModel({jobs: {review: {steps: [{prompt: 'Review.'}]}}}),
        definitionId: 'def-1',
        resolveAgentDefaults: () => Promise.reject(outage),
      }),
    ).rejects.toBe(outage);
  });
});

describe('cacheAgentDefaults', () => {
  it('asks once per distinct configuration, and replays a refusal', async () => {
    const resolve = vi.fn(refuseUnknownModel);
    const cached = cacheAgentDefaults(resolve);

    await cached({});
    await cached({});
    await cached({model: 'claude-opus-4-8'});
    const first = await Promise.resolve(cached({model: 'not-a-model'})).catch(
      (error: unknown) => error,
    );
    const second = await Promise.resolve(cached({model: 'not-a-model'})).catch(
      (error: unknown) => error,
    );

    expect(resolve).toHaveBeenCalledTimes(3);
    expect(second).toBe(first);
  });
});
