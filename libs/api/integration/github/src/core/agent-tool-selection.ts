import type {AgentToolSelectionCatalog, AgentToolSelector} from '@shipfox/api-integration-core-dto';
import type {GithubAgentToolCatalogEntry} from './agent-tools.js';

export function buildGithubAgentToolSelectionCatalog(
  catalog: readonly GithubAgentToolCatalogEntry[],
): AgentToolSelectionCatalog {
  return {
    selectors: catalog.flatMap((entry): AgentToolSelector[] => {
      if (!entry.methods) {
        return [
          {
            token: entry.id,
            kind: 'standalone',
            sensitivity: entry.sensitivity,
            sensitive: entry.sensitive,
          },
        ];
      }

      return [
        {
          token: entry.id,
          kind: 'family',
          sensitivity: entry.sensitivity,
          sensitive: entry.sensitive,
        },
        {
          token: `${entry.id}.*`,
          kind: 'family_wildcard',
          sensitivity: entry.sensitivity,
          sensitive: entry.sensitive,
        },
        ...entry.methods.map((method) => ({
          token: `${entry.id}.${method.id}`,
          kind: 'method' as const,
          sensitivity: method.sensitivity,
          sensitive: method.sensitive,
        })),
      ];
    }),
  };
}
