import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import {workflowModel} from '#test/index.js';
import {SourceConnectionUnavailableError} from './errors.js';
import {assertProjectSourceAdmits} from './project-source-admission.js';

type Checkout = Extract<
  WorkflowModel['jobs'][number]['steps'][number],
  {kind: 'checkout'}
>['checkout'];

function checkout(overrides: Partial<Checkout> = {}): Checkout {
  return {
    fetchDepth: 1,
    permissions: {contents: 'read'},
    persistCredentials: true,
    ...overrides,
  };
}

describe('assertProjectSourceAdmits', () => {
  const projectId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  let project: {sourceConnectionId: string} | null;
  let lifecycleStatus: 'active' | 'disabled' | 'error' | null;
  const getProjectById = vi.fn();
  const resolveConnectionById = vi.fn();

  function admits(model: WorkflowModel, jobKeys?: readonly string[]) {
    return assertProjectSourceAdmits({
      model,
      jobKeys,
      projectId,
      projects: {getProjectById},
      integrations: {resolveConnectionById},
    });
  }

  beforeEach(() => {
    project = {sourceConnectionId: connectionId};
    lifecycleStatus = 'active';
    getProjectById.mockReset().mockImplementation(async () => ({project}));
    resolveConnectionById
      .mockReset()
      .mockImplementation(async () =>
        lifecycleStatus === null ? null : {id: connectionId, lifecycleStatus},
      );
  });

  test('admits a job that checks out the project while the connection is active', async () => {
    await expect(admits(workflowModel())).resolves.toBeUndefined();

    expect(resolveConnectionById).toHaveBeenCalledWith({connectionId});
  });

  test.each(['error', 'disabled'] as const)('rejects a %s connection', async (status) => {
    lifecycleStatus = status;

    await expect(admits(workflowModel())).rejects.toEqual(
      new SourceConnectionUnavailableError(projectId, connectionId, status),
    );
  });

  test('rejects a connection that no longer exists', async () => {
    lifecycleStatus = null;

    await expect(admits(workflowModel())).rejects.toEqual(
      new SourceConnectionUnavailableError(projectId, connectionId, 'missing'),
    );
  });

  test('rejects a project that no longer exists', async () => {
    project = null;

    await expect(admits(workflowModel())).rejects.toEqual(
      new SourceConnectionUnavailableError(projectId, null, 'missing'),
    );
  });

  test('admits when every job opts out of checkout', async () => {
    lifecycleStatus = 'error';
    const model = workflowModel({
      jobs: {
        a: {checkout: false, steps: [{run: 'echo a'}]},
        b: {checkout: false, steps: [{run: 'echo b'}]},
      },
    });

    await expect(admits(model)).resolves.toBeUndefined();
    expect(getProjectById).not.toHaveBeenCalled();
  });

  test('rejects when one of several jobs checks out the project', async () => {
    lifecycleStatus = 'error';
    const model = workflowModel({
      jobs: {
        a: {checkout: false, steps: [{run: 'echo a'}]},
        b: {steps: [{run: 'echo b'}]},
      },
    });

    await expect(admits(model)).rejects.toBeInstanceOf(SourceConnectionUnavailableError);
  });

  test('looks only at the selected jobs', async () => {
    lifecycleStatus = 'error';
    const model = workflowModel({
      jobs: {
        a: {checkout: false, steps: [{run: 'echo a'}]},
        b: {steps: [{run: 'echo b'}]},
      },
    });

    await expect(admits(model, ['a'])).resolves.toBeUndefined();
    await expect(admits(model, ['b'])).rejects.toBeInstanceOf(SourceConnectionUnavailableError);
  });

  test('counts a first step that checks out the project root', async () => {
    lifecycleStatus = 'error';
    const model = workflowModel({
      jobs: {build: {checkout: false, steps: [{checkout: checkout()}, {run: 'make'}]}},
    });

    await expect(admits(model)).rejects.toBeInstanceOf(SourceConnectionUnavailableError);
  });

  test('counts a checkout step of the project by id', async () => {
    lifecycleStatus = 'error';
    const model = workflowModel({
      jobs: {
        build: {checkout: false, steps: [{checkout: checkout({project: projectId, path: 'src'})}]},
      },
    });

    await expect(admits(model)).rejects.toBeInstanceOf(SourceConnectionUnavailableError);
  });

  test('counts a repository checkout that uses the source connection', async () => {
    lifecycleStatus = 'error';
    const model = workflowModel({
      jobs: {
        build: {checkout: false, steps: [{checkout: checkout({repository: 'acme/tools'})}]},
      },
    });

    await expect(admits(model)).rejects.toBeInstanceOf(SourceConnectionUnavailableError);
  });

  test('counts a checkout step inside a composite step', async () => {
    lifecycleStatus = 'error';
    const model = workflowModel({
      jobs: {
        build: {
          checkout: false,
          steps: [{uses: './setup', steps: [{checkout: checkout({path: 'lib'})}]}],
        },
      },
    });

    await expect(admits(model)).rejects.toBeInstanceOf(SourceConnectionUnavailableError);
  });

  test('does not count a root checkout of another project, which replaces the job checkout', async () => {
    lifecycleStatus = 'error';
    const model = workflowModel({
      jobs: {build: {steps: [{checkout: checkout({project: crypto.randomUUID()})}]}},
    });

    await expect(admits(model)).resolves.toBeUndefined();
  });

  test('does not count a checkout of another connection', async () => {
    lifecycleStatus = 'error';
    const model = workflowModel({
      jobs: {
        build: {
          checkout: false,
          steps: [{checkout: checkout({connection: 'gitea_acme', repository: 'acme/tools'})}],
        },
      },
    });

    await expect(admits(model)).resolves.toBeUndefined();
  });
});
