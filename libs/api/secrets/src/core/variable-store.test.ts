import crypto from 'node:crypto';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {db, secretVariables} from '#db/index.js';
import {getVariable, getVariablesByNamespace, setVariables} from './variable-store.js';

describe('variable store', () => {
  it('stores plaintext variables and applies scope precedence', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();

    await setVariables({workspaceId, values: {REGION: 'us-east-1'}});
    await setVariables({workspaceId, projectId, values: {REGION: 'eu-west-1'}});
    const projectValue = await getVariable({workspaceId, projectId, key: 'REGION'});
    const values = await getVariablesByNamespace({workspaceId, projectId});
    const rows = await db().select().from(secretVariables);

    expect(projectValue).toBe('eu-west-1');
    expect(values).toEqual({REGION: 'eu-west-1'});
    expect(rows.map((row) => row.value).sort()).toEqual(['eu-west-1', 'us-east-1']);
  });
});
