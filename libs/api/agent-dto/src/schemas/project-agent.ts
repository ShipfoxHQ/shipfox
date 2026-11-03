import {z} from 'zod';

export const projectAgentDtoSchema = z.object({
  /** The file name without its extension. `shippy` is the built-in agent. */
  key: z.string(),
  /** The `name` of the agent file, or null. The built-in agent is named Shippy. */
  name: z.string().nullable(),
  description: z.string().nullable(),
  /** Set when the latest sync found the agent file invalid. The agent keeps its last valid version. */
  error: z.object({message: z.string()}).nullable(),
});

export type ProjectAgentDto = z.infer<typeof projectAgentDtoSchema>;

export const listProjectAgentsResponseSchema = z.object({
  /** The built-in agent first, then the custom agents in key order. */
  agents: z.array(projectAgentDtoSchema),
});

export type ListProjectAgentsResponseDto = z.infer<typeof listProjectAgentsResponseSchema>;
