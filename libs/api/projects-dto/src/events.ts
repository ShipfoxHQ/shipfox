import {z} from 'zod';

export const PROJECT_CREATED = 'projects.project.created' as const;
export const PROJECT_SOURCE_BOUND = 'projects.project.source_bound' as const;
export const PROJECT_SOURCE_COMMIT_OBSERVED = 'projects.project.source_commit_observed' as const;

export const projectCreatedEventSchema = z.object({
  actorId: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  sourceConnectionId: z.string(),
  sourceExternalRepositoryId: z.string(),
});
export type ProjectCreatedEvent = z.infer<typeof projectCreatedEventSchema>;

export const projectSourceBoundEventSchema = z.object({
  actorId: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  sourceConnectionId: z.string(),
  provider: z.string(),
  externalRepositoryId: z.string(),
});
export type ProjectSourceBoundEvent = z.infer<typeof projectSourceBoundEventSchema>;

export const projectSourceCommitObservedEventSchema = z.object({
  workspaceId: z.string(),
  projectId: z.string(),
  sourceConnectionId: z.string(),
  provider: z.string(),
  externalRepositoryId: z.string(),
  ref: z.string(),
  headCommitSha: z.string(),
});
export type ProjectSourceCommitObservedEvent = z.infer<
  typeof projectSourceCommitObservedEventSchema
>;

export interface ProjectsEventMap {
  [PROJECT_CREATED]: ProjectCreatedEvent;
  [PROJECT_SOURCE_BOUND]: ProjectSourceBoundEvent;
  [PROJECT_SOURCE_COMMIT_OBSERVED]: ProjectSourceCommitObservedEvent;
}

export const projectsEventSchemas = {
  [PROJECT_CREATED]: projectCreatedEventSchema,
  [PROJECT_SOURCE_BOUND]: projectSourceBoundEventSchema,
  [PROJECT_SOURCE_COMMIT_OBSERVED]: projectSourceCommitObservedEventSchema,
} satisfies Record<keyof ProjectsEventMap, z.ZodType>;
