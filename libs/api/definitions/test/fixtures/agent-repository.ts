import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import type {DefinitionsSourceControl} from '#core/integrations.js';

export const AGENT_SOURCE_CONTEXT = {
  workspaceId: 'workspace-1',
  sourceConnectionId: 'connection-1',
  sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
};

export const AGENT_FOLDER = '.shipfox/agents/';

/**
 * A source control over an in-memory repository, keyed by path. Listing returns the
 * files under the prefix, nested ones included, like the real provider.
 */
export function repositorySourceControl(files: Record<string, string>): DefinitionsSourceControl {
  return {
    resolveRepository: vi.fn(),
    listFiles: vi.fn(({prefix}: {prefix: string}) =>
      Promise.resolve({
        files: Object.entries(files)
          .filter(([path]) => path.startsWith(prefix))
          .map(([path, content]) => ({path, type: 'file' as const, size: content.length})),
        nextCursor: null,
      }),
    ),
    fetchFile: vi.fn(({path}: {path: string}) => {
      const content = files[path];
      if (content === undefined) {
        return Promise.reject(
          createInterModuleKnownError(
            integrationsInterModuleContract.methods.fetchSourceFile,
            'provider-failure',
            {reason: 'file-not-found'},
          ),
        );
      }
      return Promise.resolve({path, ref: 'main', content});
    }),
  } as unknown as DefinitionsSourceControl;
}
