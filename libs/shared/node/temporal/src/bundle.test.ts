import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runBundleCommand} from './bin/bundle.js';
import {
  bundleProductionWorkflow,
  loadProductionWorkflowBundle,
  MissingWorkflowBundleError,
  productionWorkflowBundlePaths,
  productionWorkflowBundlerOptions,
  temporalWorkerVersion,
  WorkflowBundleVersionMismatchError,
  writeProductionWorkflowBundle,
} from './bundle.js';

const mocks = vi.hoisted(() => ({
  bundleWorkflowCode: vi.fn(),
  getWorkflowInterceptorModules: vi.fn(),
}));
const semanticVersionPattern = /^\d+\.\d+\.\d+/u;

vi.mock('@temporalio/worker', () => ({bundleWorkflowCode: mocks.bundleWorkflowCode}));

vi.mock('./interceptors.js', () => ({
  getWorkflowInterceptorModules: mocks.getWorkflowInterceptorModules,
}));

let temporaryDirectory: string | undefined;

beforeEach(() => {
  mocks.bundleWorkflowCode.mockReset();
  mocks.getWorkflowInterceptorModules.mockReset();
  mocks.getWorkflowInterceptorModules.mockReturnValue(['/tmp/workflow-interceptor.js']);
});

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, {recursive: true, force: true});
  temporaryDirectory = undefined;
});

async function createWorkflowEntrypoint() {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'shipfox-temporal-bundle-'));
  const workflowsPath = join(temporaryDirectory, 'index.js');
  await writeFile(workflowsPath, 'export const workflow = () => undefined;');
  return workflowsPath;
}

async function writeBundleFiles(
  workflowsPath: string,
  meta = {temporalWorkerVersion: temporalWorkerVersion()},
) {
  const {codePath, metaPath} = productionWorkflowBundlePaths(workflowsPath);
  await writeFile(codePath, 'workflow bundle');
  await writeFile(metaPath, JSON.stringify(meta));
}

describe('productionWorkflowBundlerOptions', () => {
  it('uses production conditions without replacing Temporal resolution settings', () => {
    const extensions = ['.ts', '.js'];
    const extensionAlias = {'.js': ['.ts', '.js']};
    const webpackConfig = {resolve: {extensions, extensionAlias}};

    const result = productionWorkflowBundlerOptions().webpackConfigHook?.(webpackConfig);

    expect(result?.resolve).toEqual(
      expect.objectContaining({
        extensions,
        extensionAlias,
        conditionNames: expect.arrayContaining(['webpack', 'production', 'node', 'import']),
      }),
    );
    expect(result?.resolve?.conditionNames).not.toContain('development');
    expect(result?.resolve?.conditionNames).not.toContain('workspace-source');
  });
});

describe('bundleProductionWorkflow', () => {
  it('bakes workflow interceptors into the production bundle', async () => {
    mocks.bundleWorkflowCode.mockResolvedValue({code: 'workflow bundle'});

    await bundleProductionWorkflow('/tmp/workflows.js');

    expect(mocks.bundleWorkflowCode).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowsPath: '/tmp/workflows.js',
        workflowInterceptorModules: ['/tmp/workflow-interceptor.js'],
        webpackConfigHook: expect.any(Function),
      }),
    );
  });
});

describe('productionWorkflowBundlePaths', () => {
  it.each([
    ['/tmp/temporal/workflows/index.js', '/tmp/temporal/workflows/index.bundle.js'],
    ['/tmp/temporal/workflows/dispatch.js', '/tmp/temporal/workflows/dispatch.bundle.js'],
  ])('derives a bundle sibling for %s', (workflowsPath, codePath) => {
    const result = productionWorkflowBundlePaths(workflowsPath);

    expect(result).toEqual({
      codePath,
      metaPath: codePath.replace('.js', '.meta.json'),
    });
  });
});

describe('writeProductionWorkflowBundle', () => {
  it('writes a stamped bundle beside the workflow entrypoint', async () => {
    const workflowsPath = await createWorkflowEntrypoint();
    mocks.bundleWorkflowCode.mockResolvedValue({code: 'workflow bundle'});

    await writeProductionWorkflowBundle(workflowsPath);

    const {codePath, metaPath} = productionWorkflowBundlePaths(workflowsPath);
    const [code, meta] = await Promise.all([
      readFile(codePath, 'utf8'),
      readFile(metaPath, 'utf8'),
    ]);
    expect(code).toBe('workflow bundle');
    expect(JSON.parse(meta)).toEqual({temporalWorkerVersion: temporalWorkerVersion()});
  });

  it('fails when the workflow entrypoint is missing', async () => {
    const workflowsPath = join(tmpdir(), 'missing-workflows.js');

    const result = writeProductionWorkflowBundle(workflowsPath);

    await expect(result).rejects.toThrow(`Workflow entrypoint does not exist: ${workflowsPath}`);
  });
});

describe('loadProductionWorkflowBundle', () => {
  it('returns the bundle path when the stamp matches the runtime', async () => {
    const workflowsPath = await createWorkflowEntrypoint();
    await writeBundleFiles(workflowsPath);

    const result = loadProductionWorkflowBundle(workflowsPath);

    expect(result).toEqual({codePath: productionWorkflowBundlePaths(workflowsPath).codePath});
  });

  it('fails when either bundle artifact is missing', async () => {
    const workflowsPath = await createWorkflowEntrypoint();

    const result = () => loadProductionWorkflowBundle(workflowsPath);

    expect(result).toThrow(MissingWorkflowBundleError);
  });

  it.each(['{', '{}', 'null'])('treats malformed metadata %j as a missing bundle', async (meta) => {
    const workflowsPath = await createWorkflowEntrypoint();
    const {codePath, metaPath} = productionWorkflowBundlePaths(workflowsPath);
    await writeFile(codePath, 'workflow bundle');
    await writeFile(metaPath, meta);

    const result = () => loadProductionWorkflowBundle(workflowsPath);

    expect(result).toThrow(MissingWorkflowBundleError);
  });

  it('fails when the bundle was made by a different worker version', async () => {
    const workflowsPath = await createWorkflowEntrypoint();
    await writeBundleFiles(workflowsPath, {temporalWorkerVersion: '0.0.0'});

    const result = () => loadProductionWorkflowBundle(workflowsPath);

    expect(result).toThrow(WorkflowBundleVersionMismatchError);
  });
});

describe('temporalWorkerVersion', () => {
  it('returns the installed worker version', () => {
    const result = temporalWorkerVersion();

    expect(result).toMatch(semanticVersionPattern);
  });
});

describe('runBundleCommand', () => {
  it('writes a bundle for each workflow entrypoint', async () => {
    const workflowsPath = await createWorkflowEntrypoint();
    mocks.bundleWorkflowCode.mockResolvedValue({code: 'workflow bundle'});

    await runBundleCommand([workflowsPath]);

    const {codePath, metaPath} = productionWorkflowBundlePaths(workflowsPath);
    await expect(readFile(codePath, 'utf8')).resolves.toBe('workflow bundle');
    await expect(readFile(metaPath, 'utf8')).resolves.toContain(temporalWorkerVersion());
  });

  it('fails when no workflow entrypoint is provided', async () => {
    const result = runBundleCommand([]);

    await expect(result).rejects.toThrow('Usage: shipfox-temporal-bundle');
  });
});
