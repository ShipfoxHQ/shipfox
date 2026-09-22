import {z} from 'zod';

export const runnerCatalogNamesResponseSchema = z.object({
  names: z.array(z.string()),
});

export type RunnerCatalogNamesResponseDto = z.infer<typeof runnerCatalogNamesResponseSchema>;
