import {ApiError} from '@shipfox/client-api';
import {
  type CopySegment,
  type RunIssue,
  runIssueCopy,
  runStartErrorCopy,
} from './run-issue-copy.js';

function plain(segments: CopySegment[]): string {
  return segments.map((segment) => segment.value).join('');
}

function startError(code: string, details?: unknown, status = 422): ApiError {
  return new ApiError({
    message: `Server message for ${code}`,
    code,
    status,
    details: {
      message: `Server message for ${code}`,
      code,
      ...(details === undefined ? {} : {details}),
    },
  });
}

const FALLBACK = {title: 'Could not start the run', message: 'Try again in a moment.'};

describe('runIssueCopy', () => {
  test('names a missing variable and links to the prefilled create form', () => {
    const issue: RunIssue = {
      kind: 'variable-missing',
      key: 'E2E_SCHEDULE_ENABLED',
      locations: [{jobKey: 'e2e', field: 'job.if'}],
      effect: 'blocks-start',
    };

    const copy = runIssueCopy(issue);

    expect(copy.title).toBe('Variable E2E_SCHEDULE_ENABLED is not set');
    expect(plain(copy.message)).toBe(
      "The if on job e2e reads it. Every variable a workflow references must exist, even in a branch that doesn't run.",
    );
    expect(copy.action).toEqual({
      kind: 'link',
      label: 'Add variable',
      to: '/w/$workspaceSlug/settings/variables',
      search: {create: 'E2E_SCHEDULE_ENABLED'},
    });
  });

  test('renders step and env locations as code segments', () => {
    const copy = runIssueCopy({
      kind: 'variable-missing',
      key: 'REGION',
      locations: [{jobKey: 'e2e', step: {key: 'deploy', index: 2}, field: 'env', envKey: 'TOKEN'}],
      effect: 'fails-job',
    });

    expect(copy.message.slice(0, 5)).toEqual([
      {kind: 'text', value: 'Job '},
      {kind: 'code', value: 'e2e'},
      {kind: 'text', value: ', step '},
      {kind: 'code', value: 'deploy'},
      {kind: 'text', value: ', '},
    ]);
    expect(plain(copy.message)).toContain('Job e2e, step deploy, env.TOKEN reads it.');
  });

  test('falls back to the step name, then its position, when a step has no key', () => {
    const named = runIssueCopy({
      kind: 'variable-missing',
      key: 'K',
      locations: [{jobKey: 'build', step: {name: 'Deploy', index: 3}, field: 'run'}],
      effect: 'blocks-start',
    });
    const anonymous = runIssueCopy({
      kind: 'variable-missing',
      key: 'K',
      locations: [{jobKey: 'build', step: {index: 3}, field: 'step.if'}],
      effect: 'blocks-start',
    });

    expect(plain(named.message)).toContain('Job build, step Deploy, run reads it.');
    expect(plain(anonymous.message)).toContain('The if on step #3 in job build reads it.');
  });

  test('counts the other places, including the ones the server did not list', () => {
    const copy = runIssueCopy({
      kind: 'variable-missing',
      key: 'K',
      locations: [
        {jobKey: 'a', field: 'job.if'},
        {jobKey: 'b', field: 'job.if'},
      ],
      moreLocations: 2,
      effect: 'blocks-start',
    });

    expect(plain(copy.message)).toContain('The if on job a and 3 other places read it.');
  });

  test('says a missing step secret fails the step and links to the secret form', () => {
    const copy = runIssueCopy({
      kind: 'secret-missing',
      key: 'DEPLOY_TOKEN',
      locations: [{jobKey: 'deploy', step: {key: 'push', index: 1}, field: 'env', envKey: 'TOKEN'}],
      effect: 'fails-job',
    });

    expect(copy.title).toBe('Secret DEPLOY_TOKEN is not set');
    expect(plain(copy.message)).toBe(
      'Job deploy, step push, env.TOKEN reads it. The run will start, and this step will fail.',
    );
    expect(copy.action).toEqual({
      kind: 'link',
      label: 'Add secret',
      to: '/w/$workspaceSlug/settings/secrets',
      search: {create: 'DEPLOY_TOKEN'},
    });
  });

  test('names the trigger that passes a missing secret', () => {
    const copy = runIssueCopy({
      kind: 'trigger-secret-missing',
      key: 'API_KEY',
      trigger: {source: 'cron', name: '0 3 * * *'},
    });

    expect(copy.title).toBe('Secret API_KEY is not set');
    expect(plain(copy.message)).toBe('The 0 3 * * * trigger passes it to the workflow.');
    expect(copy.action).toMatchObject({kind: 'link', label: 'Add secret'});
  });

  test('explains an unmapped secret input without an action', () => {
    const copy = runIssueCopy({
      kind: 'secret-input-unmapped',
      key: 'TOKEN',
      trigger: {source: 'manual'},
      locations: [{jobKey: 'deploy', field: 'env', envKey: 'T'}],
    });

    expect(copy.title).toBe('Secret input TOKEN is not passed');
    expect(plain(copy.message)).toBe(
      "Job deploy, env.T reads secrets.inputs.TOKEN, but the manual trigger doesn't pass it. Add it to the trigger's secrets: in the workflow file.",
    );
    expect(copy.action).toBeUndefined();
  });

  test('names an integration that is not connected', () => {
    const copy = runIssueCopy({
      kind: 'integration-unavailable',
      connection: 'slack',
      locations: [{jobKey: 'notify', step: {key: 'post', index: 1}, field: 'tool.with'}],
      effect: 'blocks-start',
    });

    expect(copy.title).toBe('Integration slack is not connected');
    expect(plain(copy.message)).toBe('Job notify, step post, tool.with uses it.');
    expect(copy.action).toEqual({
      kind: 'link',
      label: 'Open integrations',
      to: '/w/$workspaceSlug/settings/integrations',
    });
  });

  test('names an unavailable model', () => {
    const copy = runIssueCopy({
      kind: 'agent-config-invalid',
      model: 'gpt-nope',
      locations: [{jobKey: 'review', step: {key: 'agent', index: 1}, field: 'agent.model'}],
      effect: 'blocks-start',
    });

    expect(copy.title).toBe('Model gpt-nope is not available');
    expect(copy.action).toEqual({
      kind: 'link',
      label: 'Open AI providers',
      to: '/w/$workspaceSlug/settings/agents',
    });
  });
});

describe('runStartErrorCopy', () => {
  test('maps a missing variable to its issue copy', () => {
    const copy = runStartErrorCopy(
      startError('workflow-interpolation-unresolvable', {
        field: 'job.if',
        source: 'vars.E2E_SCHEDULE_ENABLED',
        variable_key: 'E2E_SCHEDULE_ENABLED',
        job_key: 'e2e',
      }),
    );

    expect(copy.title).toBe('Variable E2E_SCHEDULE_ENABLED is not set');
    expect(plain(copy.message)).toContain('The if on job e2e reads it.');
    expect(copy.action).toMatchObject({
      kind: 'link',
      search: {create: 'E2E_SCHEDULE_ENABLED'},
    });
  });

  test('locates a missing variable in a step env', () => {
    const copy = runStartErrorCopy(
      startError('workflow-interpolation-unresolvable', {
        field: 'env',
        source: 'vars.REGION',
        env_key: 'REGION',
        variable_key: 'REGION',
        job_key: 'deploy',
        step: {key: 'push', index: 2},
      }),
    );

    expect(plain(copy.message)).toContain('Job deploy, step push, env.REGION reads it.');
  });

  test('describes an unresolved value that is not a variable', () => {
    const copy = runStartErrorCopy(
      startError('workflow-interpolation-unresolvable', {
        field: 'run',
        source: 'inputs.region',
        job_key: 'deploy',
        step: {key: 'push', index: 1},
      }),
    );

    expect(copy.title).toBe('A value in Job deploy, step push, run could not be resolved');
    expect(plain(copy.message)).toBe('inputs.region could not be resolved when the run started.');
    expect(copy.action).toBeUndefined();
  });

  test('maps a missing trigger secret to the manual trigger', () => {
    const copy = runStartErrorCopy(startError('secret-not-found', {key: 'API_KEY'}));

    expect(copy.title).toBe('Secret API_KEY is not set');
    expect(plain(copy.message)).toBe('The manual trigger passes it to the workflow.');
    expect(copy.action).toMatchObject({label: 'Add secret', search: {create: 'API_KEY'}});
  });

  test('maps a missing secret input', () => {
    const copy = runStartErrorCopy(startError('secret-input-missing', {key: 'TOKEN'}));

    expect(copy.title).toBe('Secret input TOKEN is not passed');
    expect(plain(copy.message)).toContain('A step reads secrets.inputs.TOKEN');
    expect(copy.action).toBeUndefined();
  });

  test.each([
    'secret-not-found',
    'secret-input-missing',
  ])('falls back when %s carries no key', (code) => {
    expect(runStartErrorCopy(startError(code))).toEqual({
      title: FALLBACK.title,
      message: [{kind: 'text', value: FALLBACK.message}],
    });
  });

  test('maps an unresolvable agent configuration', () => {
    const copy = runStartErrorCopy(
      startError('agent-config-unresolvable', {
        definition_id: 'def-1',
        reason: 'model-unknown',
        model: 'gpt-nope',
        job_key: 'review',
        step: {key: 'agent', index: 1},
      }),
    );

    expect(copy.title).toBe('Model gpt-nope is not available');
    expect(plain(copy.message)).toBe('Job review, step agent, agent.model uses it.');
    expect(copy.action).toMatchObject({label: 'Open AI providers'});
  });

  test('maps a failed integration materialization', () => {
    const copy = runStartErrorCopy(startError('agent-integration-materialization-failed'));

    expect(copy.title).toBe('An integration is not connected');
    expect(copy.action).toMatchObject({label: 'Open integrations'});
  });

  test('lists the invalid runner labels', () => {
    const copy = runStartErrorCopy(
      startError('invalid-job-runner-labels', {labels: ['Linux!', 'x y']}),
    );

    expect(copy.title).toBe('Runner labels are not valid');
    expect(plain(copy.message)).toBe(
      'Linux!, x y are not valid runner labels. Use lowercase letters, digits, ., _ and -.',
    );
  });

  test('reports the workflow file size against its limit', () => {
    const copy = runStartErrorCopy(
      startError('source-snapshot-too-large', {limit_bytes: 262144, measured_bytes: 524288}),
    );

    expect(copy.title).toBe('Workflow file is too large');
    expect(plain(copy.message)).toBe('It is 512 KiB. The limit is 256 KiB.');
  });

  test('names the field whose resolved value is too large', () => {
    const copy = runStartErrorCopy(
      startError('workflow-execution-payload-too-large', {
        field: 'env',
        limit_bytes: 65536,
        measured_bytes: 70000,
      }),
    );

    expect(copy.title).toBe('env is too large');
    expect(plain(copy.message)).toBe('Its resolved value is 68 KiB. The limit is 64 KiB.');
  });

  test('uses the required action of a denied admission', () => {
    const copy = runStartErrorCopy(
      startError(
        'admission-denied',
        {
          workspace_id: 'ws-1',
          reason: 'The monthly run quota is used up.',
          required_action: {
            reason: 'quota',
            message: 'Monthly quota reached',
            url: 'https://example.com/billing',
            intent: 'contact-support',
          },
        },
        409,
      ),
    );

    expect(copy.title).toBe('Monthly quota reached');
    expect(plain(copy.message)).toBe('The monthly run quota is used up.');
    expect(copy.action).toEqual({
      kind: 'link',
      label: 'Contact support',
      to: 'https://example.com/billing',
      external: true,
    });
  });

  test('labels a required action without an intent as Open', () => {
    const copy = runStartErrorCopy(
      startError(
        'admission-denied',
        {required_action: {reason: 'paused', message: 'Resume', url: '/billing'}},
        409,
      ),
    );

    expect(copy.action).toMatchObject({label: 'Open', to: '/billing'});
  });

  test('falls back to a generic title when the admission has no required action', () => {
    const copy = runStartErrorCopy(
      startError('admission-denied', {workspace_id: 'ws-1', reason: 'Paused.'}, 409),
    );

    expect(copy.title).toBe('Runs are paused for this workspace');
    expect(plain(copy.message)).toBe('Paused.');
    expect(copy.action).toBeUndefined();
  });

  test.each([
    [
      'workspace-suspended',
      409,
      'Workspace suspended',
      "Runs can't start until the workspace is active again.",
    ],
    ['workspace-not-found', 404, 'Workspace unavailable', 'This workspace no longer exists.'],
    ['workspace-deleted', 404, 'Workspace unavailable', 'This workspace no longer exists.'],
    [
      'project-mismatch',
      409,
      'Workflow configuration is inconsistent',
      'The trigger points to a workflow in another project.',
    ],
  ])('maps %s without an action', (code, status, title, message) => {
    const copy = runStartErrorCopy(startError(code, undefined, status));

    expect(copy.title).toBe(title);
    expect(plain(copy.message)).toBe(message);
    expect(copy.action).toBeUndefined();
  });

  test.each([
    'manual-trigger-not-found',
    'definition-not-found',
  ])('asks to refresh when %s', (code) => {
    const copy = runStartErrorCopy(startError(code, undefined, 404));

    expect(copy.title).toBe('This workflow changed');
    expect(plain(copy.message)).toBe(
      'It no longer has a manual trigger, or it was removed. Refresh to see the latest version.',
    );
    expect(copy.action).toEqual({kind: 'refresh', label: 'Refresh'});
  });

  test('never renders the message of an unknown API error', () => {
    const copy = runStartErrorCopy(startError('something-new', {reason: 'leaky detail'}, 500));

    expect(copy.title).toBe(FALLBACK.title);
    expect(plain(copy.message)).toBe(FALLBACK.message);
    expect(JSON.stringify(copy)).not.toContain('Server message');
    expect(copy.action).toBeUndefined();
  });

  test('never renders the message of a non-API error', () => {
    const copy = runStartErrorCopy(new Error('leaky internal detail'));

    expect(copy.title).toBe(FALLBACK.title);
    expect(JSON.stringify(copy)).not.toContain('leaky');
  });

  test('ignores malformed details', () => {
    const copy = runStartErrorCopy(
      new ApiError({
        message: 'x',
        code: 'workflow-interpolation-unresolvable',
        status: 422,
        details: 'not an object',
      }),
    );

    expect(copy.title).toBe('A value in env could not be resolved');
  });
});
