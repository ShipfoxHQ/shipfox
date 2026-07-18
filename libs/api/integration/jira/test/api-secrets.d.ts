declare module '@shipfox/api-secrets' {
  import type {NodePgDatabase} from '@shipfox/node-drizzle';

  export function getSecret(params: {
    workspaceId: string;
    namespace: string;
    key: string;
  }): Promise<string | null>;

  export function setSecrets(params: {
    workspaceId: string;
    namespace: string;
    values: Record<string, string>;
    editedBy?: string | null | undefined;
  }): Promise<void>;

  export const secretsModule: {
    database?:
      | {
          db(): NodePgDatabase<Record<string, unknown>>;
          migrationsPath: string;
        }
      | unknown[]
      | undefined;
  };
}
