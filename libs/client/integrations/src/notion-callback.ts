import type {NotionCallbackQueryDto} from '@shipfox/api-integration-notion-dto';
import {
  type BrowserStorage,
  type BrowserStorageKey,
  createTypedBrowserStorage,
} from '@shipfox/client-ui';

export const NOTION_INSTALL_WORKSPACE_KEY = 'shipfox.notion-install.workspace-id';

type WorkspaceStorage = BrowserStorage | undefined;

const notionInstallWorkspaceStorageKey = {
  key: NOTION_INSTALL_WORKSPACE_KEY,
  lifetime: 'session',
  // This hint remains readable before workspace hydration. The signed callback
  // state and returned connection remain the authoritative checks.
  principalScope: 'global',
  serialize: (workspaceId: string) => workspaceId,
  parse: (value: string) => value || undefined,
} satisfies BrowserStorageKey<string>;

export function saveNotionInstallWorkspace(storage: WorkspaceStorage, workspaceId: string): void {
  installWorkspaceStorage(storage).write(workspaceId);
}

export function readNotionInstallWorkspace(storage: WorkspaceStorage): string | undefined {
  return installWorkspaceStorage(storage).read();
}

export function clearNotionInstallWorkspace(storage: WorkspaceStorage): void {
  installWorkspaceStorage(storage).remove();
}

function installWorkspaceStorage(storage: WorkspaceStorage) {
  return createTypedBrowserStorage(() => storage, notionInstallWorkspaceStorageKey);
}

export function parseNotionCallbackQuery(
  search: Record<string, unknown>,
): NotionCallbackQueryDto | undefined {
  const state = stringParam(search.state);
  if (!state) return undefined;

  const code = stringParam(search.code);
  if (code) return {code, state};

  const error = stringParam(search.error);
  if (!error) return undefined;
  const errorDescription = stringParam(search.error_description);
  return errorDescription ? {error, error_description: errorDescription, state} : {error, state};
}

export function serializeNotionCallbackQuery(query: NotionCallbackQueryDto): string {
  const params = new URLSearchParams();
  if ('code' in query) params.set('code', query.code);
  else {
    params.set('error', query.error);
    if (query.error_description) params.set('error_description', query.error_description);
  }
  params.set('state', query.state);
  return params.toString();
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
