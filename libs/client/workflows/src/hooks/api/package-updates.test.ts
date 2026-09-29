import {configureApiClient} from '@shipfox/client-api';
import {listPackageUpdates, packageUpdatesQueryKeys} from './package-updates.js';

const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
  });
}

describe('listPackageUpdates', () => {
  test('requests the definition package updates and maps them to the client model', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({
        updates: [
          {
            kind: 'action',
            package: 'shipfox/slack-thread-digest',
            version: '1.4.2',
            latest: '1.6.0',
            behind: true,
            bump: 'major',
            capability_change: true,
            steps: ['digest.summarize'],
            changelog: [{version: '1.6.0', markdown: 'Posts the digest.'}],
          },
          {
            kind: 'template',
            package: 'shipfox/ticket-to-pr',
            version: '1.3.0',
            latest: '1.3.0',
            behind: false,
            bump: null,
            changelog: [],
          },
        ],
      }),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const updates = await listPackageUpdates({
      workspaceId: WORKSPACE_ID,
      definitionId: DEFINITION_ID,
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(new URL(request.url).pathname).toBe(
      `/workspaces/${WORKSPACE_ID}/definitions/${DEFINITION_ID}/package-updates`,
    );
    expect(updates).toEqual([
      {
        kind: 'action',
        package: 'shipfox/slack-thread-digest',
        version: '1.4.2',
        latest: '1.6.0',
        behind: true,
        bump: 'major',
        capabilityChange: true,
        steps: ['digest.summarize'],
        changelog: [{version: '1.6.0', markdown: 'Posts the digest.'}],
        upgradePrompt: null,
      },
      {
        kind: 'template',
        package: 'shipfox/ticket-to-pr',
        version: '1.3.0',
        latest: '1.3.0',
        behind: false,
        bump: null,
        capabilityChange: false,
        steps: [],
        changelog: [],
        upgradePrompt: null,
      },
    ]);
  });
});

describe('packageUpdatesQueryKeys', () => {
  test('keys the updates by workspace and definition', () => {
    expect(packageUpdatesQueryKeys.definition(WORKSPACE_ID, DEFINITION_ID)).toEqual([
      'package-updates',
      WORKSPACE_ID,
      DEFINITION_ID,
    ]);
  });
});
