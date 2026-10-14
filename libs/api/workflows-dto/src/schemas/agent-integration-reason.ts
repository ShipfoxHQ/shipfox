import {z} from 'zod';

/** Why an integration connection or tool selected by a step cannot be materialized. */
export const agentIntegrationMaterializationReasonSchema = z.enum([
  'connection-missing',
  'connection-provider-mismatch',
  'source-connection-missing',
  'tool-unknown',
  'no-tools-selected',
  'mcp-server-name-collision',
]);

export type AgentIntegrationMaterializationReason = z.infer<
  typeof agentIntegrationMaterializationReasonSchema
>;
