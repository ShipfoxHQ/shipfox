import {z} from 'zod';
import {MAX_PROJECT_ACCESS_CONNECTIONS, MAX_PROJECT_ACCESS_RESOURCES} from '../access.js';
import {projectSourceKindSchema} from './project.js';

export const projectAccessResourceInputSchema = z.object({
  kind: z.string().min(1).max(64),
  external_id: z.string().min(1).max(512),
});
export type ProjectAccessResourceInputDto = z.infer<typeof projectAccessResourceInputSchema>;

export const projectAccessConnectionInputSchema = z.object({
  connection_id: z.string().uuid(),
  // May be empty, because the config repository of a linked project counts as a resource. Core
  // refuses the other empty lists.
  resources: z.union([
    z.literal('all'),
    z.array(projectAccessResourceInputSchema).max(MAX_PROJECT_ACCESS_RESOURCES),
  ]),
});
export type ProjectAccessConnectionInputDto = z.infer<typeof projectAccessConnectionInputSchema>;

/** Replaces the whole access. `connections: "all"` resets it to the default. */
export const updateProjectAccessBodySchema = z.object({
  connections: z.union([
    z.literal('all'),
    z.array(projectAccessConnectionInputSchema).max(MAX_PROJECT_ACCESS_CONNECTIONS),
  ]),
});
export type UpdateProjectAccessBodyDto = z.infer<typeof updateProjectAccessBodySchema>;

export const projectAccessResourceDtoSchema = z.object({
  kind: z.string(),
  external_id: z.string(),
  lookup_name: z.string(),
  display_name: z.string(),
});
export type ProjectAccessResourceDto = z.infer<typeof projectAccessResourceDtoSchema>;

export const projectAccessConnectionDtoSchema = z.object({
  connection_id: z.string().uuid(),
  /** Null when the connection is gone but its scope has not been removed yet. */
  provider: z.string().nullable(),
  display_name: z.string().nullable(),
  resources: z.union([z.literal('all'), z.array(projectAccessResourceDtoSchema)]),
});
export type ProjectAccessConnectionDto = z.infer<typeof projectAccessConnectionDtoSchema>;

export const projectAccessResponseSchema = z.object({
  project_id: z.string().uuid(),
  config_source: z.object({
    kind: projectSourceKindSchema,
    connection_id: z.string().uuid(),
    external_repository_id: z.string(),
    lookup_name: z.string().nullable(),
  }),
  connections: z.union([z.literal('all'), z.array(projectAccessConnectionDtoSchema)]),
});
export type ProjectAccessResponseDto = z.infer<typeof projectAccessResponseSchema>;
