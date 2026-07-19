import {createHash} from 'node:crypto';
import type {JiraAccessibleResource, JiraAuthorization} from '#api/client.js';
import {
  deleteJiraPendingSelection,
  getJiraPendingSelection,
  listExpiredJiraPendingSelections,
  saveJiraPendingSelection,
} from '#db/pending-selections.js';

const PENDING_SELECTION_TTL_MS = 30 * 60 * 1000;
const ACCESS_TOKEN_KEY = 'ACCESS_TOKEN';
const REFRESH_TOKEN_KEY = 'REFRESH_TOKEN';
const TOKEN_EXPIRES_AT_KEY = 'TOKEN_EXPIRES_AT';

export interface JiraPendingSelectionSecretsStore {
  getSecret(params: {workspaceId: string; namespace: string; key: string}): Promise<string | null>;
  setSecrets(params: {
    workspaceId: string;
    namespace: string;
    values: Record<string, string>;
    editedBy?: string | null | undefined;
  }): Promise<void>;
  deleteSecrets(params: {workspaceId: string; namespace: string}): Promise<number>;
}

export interface JiraPendingSelectionStore {
  save(params: {
    workspaceId: string;
    state: string;
    authorization: JiraAuthorization;
    sites: JiraAccessibleResource[];
  }): Promise<void>;
  load(params: {
    workspaceId: string;
    state: string;
  }): Promise<{authorization: JiraAuthorization; sites: JiraAccessibleResource[]} | undefined>;
  clear(params: {workspaceId: string; state: string}): Promise<void>;
  pruneExpiredPendingSelections(now: Date): Promise<void>;
}

export function jiraPendingSecretsNamespace(state: string): string {
  return `system/integrations/jira/pending/${stateHash(state)}`;
}

export function createJiraPendingSelectionStore(params: {
  secrets: JiraPendingSelectionSecretsStore;
}): JiraPendingSelectionStore {
  async function clear(input: {workspaceId: string; state: string}): Promise<void> {
    const hash = stateHash(input.state);
    await Promise.all([
      deleteJiraPendingSelection({stateHash: hash, workspaceId: input.workspaceId}),
      params.secrets.deleteSecrets({
        workspaceId: input.workspaceId,
        namespace: jiraPendingSecretsNamespace(input.state),
      }),
    ]);
  }

  return {
    async save(input) {
      const expiresAt = new Date(Date.now() + PENDING_SELECTION_TTL_MS);
      const values: Record<string, string> = {[ACCESS_TOKEN_KEY]: input.authorization.accessToken};
      if (input.authorization.refreshToken)
        values[REFRESH_TOKEN_KEY] = input.authorization.refreshToken;
      if (input.authorization.expiresAt)
        values[TOKEN_EXPIRES_AT_KEY] = input.authorization.expiresAt.toISOString();
      await params.secrets.setSecrets({
        workspaceId: input.workspaceId,
        namespace: jiraPendingSecretsNamespace(input.state),
        values,
      });
      await saveJiraPendingSelection({
        stateHash: stateHash(input.state),
        workspaceId: input.workspaceId,
        expiresAt,
        sites: input.sites,
      });
    },

    async load(input) {
      const pending = await getJiraPendingSelection({
        stateHash: stateHash(input.state),
        workspaceId: input.workspaceId,
      });
      if (!pending) return undefined;
      if (pending.expiresAt < new Date()) {
        await clear(input);
        return undefined;
      }
      const namespace = jiraPendingSecretsNamespace(input.state);
      const [accessToken, refreshToken, tokenExpiresAt] = await Promise.all([
        params.secrets.getSecret({
          workspaceId: input.workspaceId,
          namespace,
          key: ACCESS_TOKEN_KEY,
        }),
        params.secrets.getSecret({
          workspaceId: input.workspaceId,
          namespace,
          key: REFRESH_TOKEN_KEY,
        }),
        params.secrets.getSecret({
          workspaceId: input.workspaceId,
          namespace,
          key: TOKEN_EXPIRES_AT_KEY,
        }),
      ]);
      if (!accessToken || !refreshToken) {
        await clear(input);
        return undefined;
      }
      const expiresAt = tokenExpiresAt ? new Date(tokenExpiresAt) : undefined;
      return {
        authorization: {
          accessToken,
          refreshToken,
          expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : undefined,
          scopes: [],
        },
        sites: pending.sites,
      };
    },

    clear,

    async pruneExpiredPendingSelections(now) {
      const expired = await listExpiredJiraPendingSelections(now);
      await Promise.all(
        expired.map(async (pending) => {
          await params.secrets.deleteSecrets({
            workspaceId: pending.workspaceId,
            namespace: `system/integrations/jira/pending/${pending.stateHash}`,
          });
          await deleteJiraPendingSelection({
            stateHash: pending.stateHash,
            workspaceId: pending.workspaceId,
          });
        }),
      );
    },
  };
}

function stateHash(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}
