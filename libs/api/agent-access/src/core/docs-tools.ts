import {
  agentAccessOutputSchema,
  searchDocsInputJsonSchema,
  searchDocsInputSchema,
  searchDocsResultJsonSchema,
  searchDocsResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {DocsCache} from './docs.js';
import {DocsUnavailableError} from './docs.js';
import {agentAccessError, agentAccessSuccess} from './envelope.js';
import type {AgentAccessTool} from './tools.js';

export function createSearchDocsTool(docs: DocsCache): AgentAccessTool {
  return {
    name: 'search_docs',
    description: 'Search the Shipfox documentation. Read a hit with its docs:// URI.',
    inputSchema: searchDocsInputJsonSchema,
    outputSchema: agentAccessOutputSchema(searchDocsResultJsonSchema),
    validateInput: (input) => searchDocsInputSchema.safeParse(input).success,
    validateResult: (result) => searchDocsResultSchema.safeParse(result).success,
    annotations: {readOnlyHint: true},
    execute: async ({arguments: input}) => {
      const parsed = searchDocsInputSchema.safeParse(input);
      if (!parsed.success) return agentAccessError('invalid-request');
      try {
        return agentAccessSuccess({hits: await docs.search(parsed.data.query)});
      } catch (error) {
        if (error instanceof DocsUnavailableError) {
          return agentAccessError('docs-unavailable', {message: error.message});
        }
        throw error;
      }
    },
  };
}
