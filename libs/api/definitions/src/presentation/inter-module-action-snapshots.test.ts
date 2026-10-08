import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createTestFeatureFlags} from '@shipfox/node-feature-flags/testing';
import {createFakeInterModuleClients} from '@shipfox/node-module/inter-module/testing';
import {decodeActionBundle, encodeActionBundle} from '@shipfox/workflow-document';
import {upsertActionSnapshot} from '#db/action-snapshots.js';
import {createDefinitionsInterModulePresentation} from './inter-module.js';

const FILES = [
  {path: 'action.yml', content: 'name: Hello\nmain: index.ts\n'},
  {path: 'index.ts', content: 'export default 1;\n'},
];
const MANIFEST = {name: 'Hello', main: 'index.ts'};

function definitionsClient() {
  return createFakeInterModuleClients({
    definitions: createDefinitionsInterModulePresentation({
      projects: {} as never,
      agent: {} as never,
      integrations: {} as never,
      flags: createTestFeatureFlags(),
    }),
  }).definitions;
}

describe('getActionSnapshot inter-module method', () => {
  it('returns a JSON-safe snapshot whose bundle decodes to the stored files', async () => {
    const workspaceId = crypto.randomUUID();
    const bundle = await encodeActionBundle({files: FILES});
    await upsertActionSnapshot({
      workspaceId,
      projectId: crypto.randomUUID(),
      manifest: MANIFEST,
      bundle,
      source: 'vcs',
    });

    const result = await definitionsClient().getActionSnapshot({
      workspaceId,
      digest: bundle.digest,
    });
    // The HTTP transport carries the same value as JSON.
    const overHttp = definitionsInterModuleContract.methods.getActionSnapshot.output.parse(
      JSON.parse(JSON.stringify(result)),
    );

    expect(overHttp).toEqual(result);
    expect(result).toMatchObject({manifest: MANIFEST, bytes: bundle.bytes});
    await expect(
      decodeActionBundle({
        gzip: Buffer.from(result.bundleGzipBase64, 'base64'),
        digest: bundle.digest,
      }),
    ).resolves.toEqual(FILES);
  });

  it('rejects a digest stored in another workspace as action-snapshot-not-found', async () => {
    const bundle = await encodeActionBundle({files: FILES});
    await upsertActionSnapshot({
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      manifest: MANIFEST,
      bundle,
      source: 'vcs',
    });

    const error = await definitionsClient()
      .getActionSnapshot({workspaceId: crypto.randomUUID(), digest: bundle.digest})
      .catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(definitionsInterModuleContract.methods.getActionSnapshot, error),
    ).toBe(true);
    expect(error).toMatchObject({
      code: 'action-snapshot-not-found',
      details: {digest: bundle.digest},
    });
  });
});
