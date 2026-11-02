import {and, eq} from 'drizzle-orm';
import {db} from './db.js';
import {managedRefs} from './schema/refs.js';

export async function getRefCommitOid(params: {
  repositoryId: string;
  name: string;
}): Promise<string | undefined> {
  const [row] = await db()
    .select({commitOid: managedRefs.commitOid})
    .from(managedRefs)
    .where(
      and(eq(managedRefs.repositoryId, params.repositoryId), eq(managedRefs.name, params.name)),
    )
    .limit(1);
  return row?.commitOid;
}
