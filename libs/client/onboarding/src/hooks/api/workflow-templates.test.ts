import {configureApiClient} from '@shipfox/client-api';
import {describe, expect, test, vi} from '@shipfox/vitest/vi';
import {listWorkspaceWorkflowTemplates} from './workflow-templates.js';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';

describe('listWorkspaceWorkflowTemplates', () => {
  test('reads the workspace templates and maps them to the domain model', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          templates: [
            {
              id: 'fix-dependency-ci',
              title: 'Repair failing pull request CI',
              summary: 'Get a tested fix when CI fails on a dependency update.',
              group: 'starts_on_event',
              start_label: 'Starts on a failing dependency update',
              providers: ['github'],
              missing_providers: [],
              prompt: 'Use Shipfox to create a workflow from the fix-dependency-ci template.',
            },
          ],
        }),
        {status: 200, headers: {'content-type': 'application/json'}},
      ),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    await expect(listWorkspaceWorkflowTemplates({workspaceId: WORKSPACE_ID})).resolves.toEqual([
      {
        id: 'fix-dependency-ci',
        title: 'Repair failing pull request CI',
        summary: 'Get a tested fix when CI fails on a dependency update.',
        group: 'starts_on_event',
        startLabel: 'Starts on a failing dependency update',
        providers: ['github'],
        prompt: 'Use Shipfox to create a workflow from the fix-dependency-ci template.',
      },
    ]);
    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${WORKSPACE_ID}/workflow-templates`,
    );
  });
});
