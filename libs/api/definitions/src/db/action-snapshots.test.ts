import {encodeActionBundle} from '@shipfox/workflow-document';
import {and, eq} from 'drizzle-orm';
import {getActionSnapshot, upsertActionSnapshot} from './action-snapshots.js';
import {db} from './db.js';
import {definitionActionSnapshots} from './schema/action-snapshots.js';

const MANIFEST = {name: 'Hello', main: 'index.ts'};

describe('action snapshot queries', () => {
  let workspaceId: string;
  let projectId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
  });

  it('stores and reads a snapshot', async () => {
    const bundle = await encodeActionBundle({
      files: [{path: 'index.ts', content: `export default '${workspaceId}';\n`}],
    });

    await upsertActionSnapshot({workspaceId, projectId, manifest: MANIFEST, bundle, source: 'vcs'});
    const snapshot = await getActionSnapshot({workspaceId, digest: bundle.digest});

    expect(snapshot).toMatchObject({
      workspaceId,
      digest: bundle.digest,
      projectId,
      manifest: MANIFEST,
      fileCount: 1,
      bytes: bundle.bytes,
      source: 'vcs',
    });
    expect(snapshot?.bundle).toEqual(bundle.gzip);
  });

  it('keeps the first row when the same digest is stored again', async () => {
    const bundle = await encodeActionBundle({
      files: [{path: 'index.ts', content: `export default '${workspaceId}';\n`}],
    });
    await upsertActionSnapshot({workspaceId, projectId, manifest: MANIFEST, bundle, source: 'vcs'});

    await upsertActionSnapshot({
      workspaceId,
      projectId: crypto.randomUUID(),
      manifest: MANIFEST,
      bundle,
      source: 'dev_local',
    });

    const rows = await db()
      .select()
      .from(definitionActionSnapshots)
      .where(
        and(
          eq(definitionActionSnapshots.workspaceId, workspaceId),
          eq(definitionActionSnapshots.digest, bundle.digest),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({projectId, source: 'vcs'});
  });

  it('isolates snapshots by workspace', async () => {
    const otherWorkspaceId = crypto.randomUUID();
    const bundle = await encodeActionBundle({
      files: [{path: 'index.ts', content: `export default '${workspaceId}';\n`}],
    });
    await upsertActionSnapshot({workspaceId, projectId, manifest: MANIFEST, bundle, source: 'vcs'});

    const missing = await getActionSnapshot({workspaceId: otherWorkspaceId, digest: bundle.digest});
    await upsertActionSnapshot({
      workspaceId: otherWorkspaceId,
      projectId: crypto.randomUUID(),
      manifest: MANIFEST,
      bundle,
      source: 'dev_local',
    });
    const own = await getActionSnapshot({workspaceId: otherWorkspaceId, digest: bundle.digest});

    expect(missing).toBeUndefined();
    expect(own?.source).toBe('dev_local');
    expect((await getActionSnapshot({workspaceId, digest: bundle.digest}))?.source).toBe('vcs');
  });
});
