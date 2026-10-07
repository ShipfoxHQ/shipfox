import type {Step} from '#core/entities/step.js';
import {InterpolationUnresolvableError} from '#core/errors.js';
import {type TestJobContainer, workflowModel} from '#test/index.js';
import {completeStepDispatchConfig} from './complete-step-dispatch-config.js';
import {
  type MaterializedWorkflowStep,
  materializeJobExecutionSteps,
} from './materialize-job-execution-steps.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

function template(source: string): string {
  return `\${{ ${source} }}`;
}

function creationContext(values: Record<string, unknown> = {}): WorkflowEvaluationContext {
  return {
    site: 'run-creation',
    values: {
      run: {id: 'run-1', name: 'Build', definition_id: 'def-1'},
      trigger: {source: 'manual', event: 'fire'},
      event: null,
      inputs: null,
      ...values,
    },
  };
}

function dispatchContext(values: Record<string, unknown> = {}): WorkflowEvaluationContext {
  return {site: 'step-dispatch', values: {...creationContext().values, ...values}};
}

async function setupStep(
  container: TestJobContainer | undefined,
  context = creationContext(),
): Promise<MaterializedWorkflowStep> {
  const model = workflowModel({
    jobs: {build: {...(container === undefined ? {} : {container}), steps: [{run: 'echo hi'}]}},
  });
  const job = model.jobs[0];
  if (!job) throw new Error('Test model created no jobs');
  const [setup] = await materializeJobExecutionSteps({model, job, context});
  if (!setup) throw new Error('Expected a setup step');
  return setup;
}

function pendingStep(setup: MaterializedWorkflowStep): Step {
  return {
    id: 'step-1',
    jobExecutionId: 'exec-1',
    key: null,
    name: setup.name,
    sourceLocation: null,
    status: 'pending',
    statusReason: null,
    evaluationTrace: null,
    type: 'setup',
    config: {...setup.config},
    condition: null,
    runAfter: 'success',
    configPlan: setup.configPlan ?? null,
    authoredConfig: null,
    error: null,
    position: 0,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
    updatedAt: new Date('2026-06-30T12:00:00.000Z'),
  };
}

async function dispatch(setup: MaterializedWorkflowStep, context = dispatchContext()) {
  return await completeStepDispatchConfig({
    step: pendingStep(setup),
    context,
    definitionId: 'def-1',
  });
}

describe('setup step container', () => {
  it('leaves the setup config without a container for a job that has none', async () => {
    const setup = await setupStep(undefined);

    expect(setup.config).not.toHaveProperty('container');
  });

  it('carries a literal image string with the defaults', async () => {
    const setup = await setupStep('node:24-bookworm');

    expect(setup.config.container).toEqual({
      image: 'node:24-bookworm',
      options: '',
      docker_socket: true,
      env: {},
    });
    expect(setup.configPlan).toBeUndefined();
  });

  it('keeps the container next to the checkout policy', async () => {
    const setup = await setupStep('node:24-bookworm');

    expect(setup.config).toMatchObject({
      checkout: {persist_credentials: true},
      container: {image: 'node:24-bookworm'},
    });
  });

  it('fills the image and options from the run-creation context', async () => {
    const setup = await setupStep(
      {
        image: `registry.example/${template('vars.TOOLBOX')}:1`,
        options: `--cpus ${template('vars.CPUS')}`,
        dockerSocket: false,
      },
      creationContext({vars: {TOOLBOX: 'toolbox', CPUS: '4'}}),
    );

    expect(setup.config.container).toEqual({
      image: 'registry.example/toolbox:1',
      options: '--cpus 4',
      docker_socket: false,
      env: {},
    });
    expect(setup.configPlan?.trace).toEqual([
      expect.objectContaining({expression: 'vars.TOOLBOX', field: 'job.container.image'}),
      expect.objectContaining({expression: 'vars.CPUS', field: 'job.container.options'}),
    ]);
  });

  it('defers an image that reads a context the creation site lacks until dispatch', async () => {
    const setup = await setupStep({image: template('steps.pick.outputs.image')});

    expect(setup.config.container).toMatchObject({image: ''});
    expect(setup.configPlan?.container?.image).toBeDefined();

    const completed = await dispatch(
      setup,
      dispatchContext({steps: {pick: {outputs: {image: 'node:24'}}}}),
    );

    expect(completed.config.container).toMatchObject({image: 'node:24'});
  });

  it('fails dispatch when a deferred image still cannot be filled', async () => {
    const setup = await setupStep({image: template('steps.pick.outputs.image')});

    await expect(dispatch(setup)).rejects.toBeInstanceOf(InterpolationUnresolvableError);
  });

  describe('registry credentials', () => {
    it('puts a literal username in the config and the secret password in a binding', async () => {
      const setup = await setupStep({
        image: 'ghcr.io/acme/toolbox:1',
        credentials: {username: 'acme-bot', password: template('secrets.GHCR_TOKEN')},
      });

      const completed = await dispatch(setup);

      expect(completed.config.container).toEqual({
        image: 'ghcr.io/acme/toolbox:1',
        options: '',
        docker_socket: true,
        env: {},
        username: 'acme-bot',
      });
      expect(completed.config.secret_bindings).toEqual([
        {
          target: {kind: 'container_credential', field: 'password'},
          segments: [{kind: 'secret', store: 'local', key: 'GHCR_TOKEN'}],
        },
      ]);
    });

    it('binds both the username and the password when both are secrets', async () => {
      const setup = await setupStep({
        image: 'ghcr.io/acme/toolbox:1',
        credentials: {
          username: template('secrets.REGISTRY_USER'),
          password: template('secrets.REGISTRY_TOKEN'),
        },
      });

      const completed = await dispatch(setup);

      expect(completed.config.container).not.toHaveProperty('username');
      expect(completed.config.secret_bindings).toEqual([
        {
          target: {kind: 'container_credential', field: 'username'},
          segments: [{kind: 'secret', store: 'local', key: 'REGISTRY_USER'}],
        },
        {
          target: {kind: 'container_credential', field: 'password'},
          segments: [{kind: 'secret', store: 'local', key: 'REGISTRY_TOKEN'}],
        },
      ]);
      expect(completed.trace).toEqual([
        expect.objectContaining({
          expression: 'secrets.REGISTRY_USER',
          field: 'job.container.credentials',
          reference: true,
        }),
        expect.objectContaining({
          expression: 'secrets.REGISTRY_TOKEN',
          field: 'job.container.credentials',
          reference: true,
        }),
      ]);
    });

    it('hands a literal password over as a binding too', async () => {
      const setup = await setupStep({
        image: 'ghcr.io/acme/toolbox:1',
        credentials: {username: 'acme-bot', password: 'hunter2'},
      });

      const completed = await dispatch(setup);

      expect(completed.config.container).not.toHaveProperty('password');
      expect(completed.config.secret_bindings).toEqual([
        {
          target: {kind: 'container_credential', field: 'password'},
          segments: [{kind: 'literal', value: 'hunter2'}],
        },
      ]);
    });

    it('fills a username from a variable at run creation', async () => {
      const setup = await setupStep(
        {
          image: 'ghcr.io/acme/toolbox:1',
          credentials: {
            username: template('vars.REGISTRY_USER'),
            password: template('secrets.REGISTRY_TOKEN'),
          },
        },
        creationContext({vars: {REGISTRY_USER: 'acme-bot'}}),
      );

      expect(setup.config.container).toMatchObject({username: 'acme-bot'});
      expect(setup.configPlan?.container?.username).toBeUndefined();
    });
  });

  describe('container env', () => {
    it('keeps literal values in the config and binds secret values', async () => {
      const env = {
        MODE: 'ci',
        REGION: template('vars.REGION'),
        LICENSE_KEY: `key-${template('secrets.TOOLBOX_LICENSE')}`,
      };
      const setup = await setupStep(
        {image: 'node:24', env},
        creationContext({vars: {REGION: 'eu'}}),
      );

      const completed = await dispatch(setup);

      expect(completed.config.container).toMatchObject({env: {MODE: 'ci', REGION: 'eu'}});
      expect(completed.config.secret_bindings).toEqual([
        {
          target: {kind: 'container_env', name: 'LICENSE_KEY'},
          segments: [
            {kind: 'literal', value: 'key-'},
            {kind: 'secret', store: 'local', key: 'TOOLBOX_LICENSE'},
          ],
        },
      ]);
      expect(completed.trace).toContainEqual(
        expect.objectContaining({
          expression: 'secrets.TOOLBOX_LICENSE',
          field: 'job.container.env.value',
          envKey: 'LICENSE_KEY',
        }),
      );
    });

    it('never writes a secret value into the container config', async () => {
      const setup = await setupStep({
        image: 'node:24',
        env: {LICENSE_KEY: template('secrets.TOOLBOX_LICENSE')},
      });

      const completed = await dispatch(setup);

      expect(completed.config.container).toMatchObject({env: {}});
    });
  });
});
