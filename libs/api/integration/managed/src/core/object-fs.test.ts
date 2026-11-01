import {Buffer} from 'node:buffer';
import {inflateSync} from 'node:zlib';
import {eq} from 'drizzle-orm';
import {readBlob, writeBlob, writeRef} from 'isomorphic-git';
import {createObjectFs, MANAGED_GITDIR} from '#core/object-fs.js';
import {db} from '#db/db.js';
import {getObjectData, insertObjects} from '#db/objects.js';
import {managedObjects} from '#db/schema/objects.js';
import {createRepositoryRow} from '#test/fixtures/repository.js';

const blob = new TextEncoder().encode('on: push\n');
const SOME_COMMIT_OID = 'a'.repeat(40);

async function writeTestBlob(repositoryId: string) {
  const objects = createObjectFs({repositoryId});
  const oid = await writeBlob({fs: objects.client, gitdir: MANAGED_GITDIR, blob});
  return {objects, oid};
}

describe('createObjectFs', () => {
  it('keeps a write in the buffer until the caller inserts it', async () => {
    const {id} = await createRepositoryRow();

    const {objects} = await writeTestBlob(id);

    const rows = await db()
      .select()
      .from(managedObjects)
      .where(eq(managedObjects.repositoryId, id));
    expect(rows).toEqual([]);
    expect(objects.bufferedObjects()).toHaveLength(1);
  });

  it('reads an object from the buffer before it reaches the database', async () => {
    const {id} = await createRepositoryRow();
    const {objects, oid} = await writeTestBlob(id);

    const result = await readBlob({fs: objects.client, gitdir: MANAGED_GITDIR, oid});

    expect(Buffer.from(result.blob).toString()).toBe('on: push\n');
  });

  it('stores a standard deflated git object', async () => {
    const {id} = await createRepositoryRow();
    const {objects, oid} = await writeTestBlob(id);

    await insertObjects({repositoryId: id, objects: objects.bufferedObjects()});

    const data = await getObjectData({repositoryId: id, oid});
    expect(inflateSync(data as Buffer).toString()).toBe('blob 9\0on: push\n');
  });

  it('reads an inserted object in a later operation', async () => {
    const {id} = await createRepositoryRow();
    const {objects, oid} = await writeTestBlob(id);
    await insertObjects({repositoryId: id, objects: objects.bufferedObjects()});

    const result = await readBlob({
      fs: createObjectFs({repositoryId: id}).client,
      gitdir: MANAGED_GITDIR,
      oid,
    });

    expect(Buffer.from(result.blob).toString()).toBe('on: push\n');
  });

  it('treats a repeated insert as a no-op', async () => {
    const {id} = await createRepositoryRow();
    const {objects} = await writeTestBlob(id);
    await insertObjects({repositoryId: id, objects: objects.bufferedObjects()});

    const repeated = insertObjects({repositoryId: id, objects: objects.bufferedObjects()});

    await expect(repeated).resolves.toBeUndefined();
  });

  it("doesn't read an object through another repository", async () => {
    const owner = await createRepositoryRow();
    const other = await createRepositoryRow();
    const {objects, oid} = await writeTestBlob(owner.id);
    await insertObjects({repositoryId: owner.id, objects: objects.bufferedObjects()});
    const {client} = createObjectFs({repositoryId: other.id});

    const read = readBlob({fs: client, gitdir: MANAGED_GITDIR, oid});

    await expect(read).rejects.toMatchObject({code: 'NotFoundError'});
  });

  it('refuses a ref write from the library', async () => {
    const {id} = await createRepositoryRow();
    const {client} = createObjectFs({repositoryId: id});

    const write = writeRef({
      fs: client,
      gitdir: MANAGED_GITDIR,
      ref: 'refs/heads/main',
      value: SOME_COMMIT_OID,
      force: true,
    });

    await expect(write).rejects.toThrow('only writes objects');
  });

  it.each([
    'config',
    'index',
    'shallow',
    'HEAD',
    'refs/heads/main',
    'packed-refs',
    'objects/pack/x.idx',
    'objects/ab/../cd/ef',
    '../secret',
  ])('reports %s as absent', async (path) => {
    const {id} = await createRepositoryRow();
    const {client} = createObjectFs({repositoryId: id});

    const read = client.promises.readFile(`${MANAGED_GITDIR}/${path}`);

    await expect(read).rejects.toMatchObject({code: 'ENOENT'});
  });

  it('refuses a write outside objects', async () => {
    const {id} = await createRepositoryRow();
    const {client} = createObjectFs({repositoryId: id});

    const write = client.promises.writeFile(`${MANAGED_GITDIR}/config`, Uint8Array.of(1));

    await expect(write).rejects.toThrow('only writes objects');
  });

  it('reports the git directory as a directory and an object as absent', async () => {
    const {id} = await createRepositoryRow();
    const {client} = createObjectFs({repositoryId: id});

    const gitdir = await client.promises.stat(MANAGED_GITDIR);
    const object = client.promises.stat(`${MANAGED_GITDIR}/objects/ab/${'c'.repeat(38)}`);

    expect(gitdir.isDirectory()).toBe(true);
    await expect(object).rejects.toMatchObject({code: 'ENOENT'});
  });
});
