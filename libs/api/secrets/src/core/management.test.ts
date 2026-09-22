import {eq} from 'drizzle-orm';
import {db, secretDataKeys, secretVariables} from '#db/index.js';
import {listVariableNames, setManagedSecrets, setManagedVariables} from './index.js';

const metricMocks = vi.hoisted(() => ({
  recordSecretsOperation: vi.fn(),
}));

vi.mock('#metrics/instance.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#metrics/instance.js')>()),
  recordSecretsOperation: metricMocks.recordSecretsOperation,
}));

describe('secrets management core', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    metricMocks.recordSecretsOperation.mockClear();
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

  it('records list metrics for variable name reads', async () => {
    await setManagedVariables({
      workspaceId,
      actorId: crypto.randomUUID(),
      entries: [{key: 'REGION', value: 'us-east-1'}],
    });
    metricMocks.recordSecretsOperation.mockClear();

    const result = await listVariableNames({workspaceId});

    expect(result).toEqual({names: ['REGION']});
    expect(metricMocks.recordSecretsOperation).toHaveBeenCalledExactlyOnceWith({
      resource: 'variable',
      operation: 'list',
      surface: 'management',
      scope: 'workspace',
      outcome: 'success',
      durationMs: expect.any(Number),
    });
  });
});
