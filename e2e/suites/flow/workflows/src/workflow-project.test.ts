import {beforeEach, describe, expect, test, vi} from '@shipfox/vitest/vi';
import type {SuiteContext} from './suite-context.js';

const requestJson = vi.fn();
const createApiClient = vi.fn(() => ({requestJson}));
const commitFiles = vi.fn();
const createIssue = vi.fn();
const createRepo = vi.fn();
const createProject = vi.fn();

const suite = {
  workspaceId: 'workspace-id',
  org: 'shipfox',
  connectionId: 'connection-id',
  connectionSlug: 'gitea',
  modelProviderId: 'model-provider-id',
  agentModel: 'agent-model',
} as SuiteContext;

describe('seedProjectWithApiDefinition', () => {
  beforeEach(() => {
    vi.resetModules();
    requestJson.mockReset();
    createApiClient.mockClear();
    commitFiles.mockReset();
    createIssue.mockReset();
    createRepo.mockReset();
    createProject.mockReset();
    createProject.mockResolvedValue({id: 'project-id'});
    requestJson.mockResolvedValue({id: 'definition-id', diagnostics: []});
    vi.doMock('@shipfox/e2e-core', () => ({createApiClient}));
    vi.doMock('@shipfox/e2e-driver-gitea', () => ({commitFiles, createIssue, createRepo}));
    vi.doMock('./create-project.js', () => ({
      createProject,
      giteaExternalRepositoryId: (org: string, repo: string) => `gitea:${org}/${repo}`,
    }));
  });

  test('keeps API-only definitions manual by default', async () => {
    const {seedProjectWithApiDefinition} = await import('./workflow-project.js');

    await seedProjectWithApiDefinition({
      suite,
      token: 'token',
      name: 'manual fixture',
      repo: 'manual-fixture',
      runnerLabel: 'runner-label',
      workflowYaml: 'name: Manual\nrunner: __RUNNER_LABEL__\n',
      configPath: '.shipfox/workflows/manual.yml',
    });

    expect(commitFiles).not.toHaveBeenCalled();
    expect(requestJson).toHaveBeenCalledWith('post', '/definitions', {
      json: {
        project_id: 'project-id',
        source: 'manual',
        yaml: 'name: Manual\nrunner: runner-label\n',
      },
    });
  });

  test('backs VCS definitions with the committed parent and child files', async () => {
    const {seedProjectWithApiDefinition} = await import('./workflow-project.js');

    await seedProjectWithApiDefinition({
      suite,
      token: 'token',
      name: 'child fixture',
      repo: 'child-fixture',
      runnerLabel: 'runner-label',
      workflowYaml: 'name: Parent\nrunner: __RUNNER_LABEL__\n',
      configPath: '.shipfox/workflows/parent.yml',
      repositoryBacked: true,
      additionalDefinitions: [
        {
          configPath: '.shipfox/workflows/child.yml',
          workflowYaml: 'name: Child\nrunner: __RUNNER_LABEL__\n',
        },
      ],
    });

    expect(commitFiles).toHaveBeenCalledWith({
      org: 'shipfox',
      repo: 'child-fixture',
      message: 'seed child fixture',
      files: [
        {
          path: '.shipfox/workflows/parent.yml',
          content: 'name: Parent\nrunner: runner-label\n',
        },
        {
          path: '.shipfox/workflows/child.yml',
          content: 'name: Child\nrunner: runner-label\n',
        },
      ],
    });
    expect(createProject.mock.invocationCallOrder[0]).toBeLessThan(
      commitFiles.mock.invocationCallOrder[0] as number,
    );
    expect(requestJson).toHaveBeenCalledWith('post', '/definitions', {
      json: {
        project_id: 'project-id',
        config_path: '.shipfox/workflows/parent.yml',
        source: 'vcs',
        ref: 'main',
        yaml: 'name: Parent\nrunner: runner-label\n',
      },
    });
    expect(requestJson).toHaveBeenCalledWith('post', '/definitions', {
      json: {
        project_id: 'project-id',
        config_path: '.shipfox/workflows/child.yml',
        source: 'vcs',
        ref: 'main',
        yaml: 'name: Child\nrunner: runner-label\n',
      },
    });
  });
});
