import {eq} from 'drizzle-orm';
import {db, secretDataKeys, secretVariables} from '#db/index.js';
import {setManagedSecrets, setManagedVariables} from './index.js';

describe('secrets management core', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('treats empty managed writes as no-ops', async () => {
    const secretResult = await setManagedSecrets({
      workspaceId,
      actorId: crypto.randomUUID(),
      entries: [],
    });
    const variableResult = await setManagedVariables({
      workspaceId,
      actorId: crypto.randomUUID(),
      entries: [],
    });

    const dataKeys = await db()
      .select()
      .from(secretDataKeys)
      .where(eq(secretDataKeys.workspaceId, workspaceId));
    const variables = await db()
      .select()
      .from(secretVariables)
      .where(eq(secretVariables.workspaceId, workspaceId));
    expect(secretResult).toEqual([]);
    expect(variableResult).toEqual([]);
    expect(dataKeys).toHaveLength(0);
    expect(variables).toHaveLength(0);
  });
});
