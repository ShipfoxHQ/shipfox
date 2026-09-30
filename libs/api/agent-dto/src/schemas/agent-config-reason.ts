import {z} from 'zod';

/** Why an agent step's model, provider, harness or thinking settings cannot be used. */
export const agentConfigInvalidReasonSchema = z.enum([
  'model-unknown',
  'provider-unsupported',
  'harness-unsupported',
  'thinking-unsupported',
  'workspace-providers-disabled',
]);

export type AgentConfigInvalidReason = z.infer<typeof agentConfigInvalidReasonSchema>;
