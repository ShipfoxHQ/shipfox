import {z} from 'zod';

const nonEmptyStringSchema = z.string().nonempty();

export const PROJECT_CREATED = 'projects.project.created' as const;
export const PROJECT_UPDATED = 'projects.project.updated' as const;
export const PROJECT_DELETED = 'projects.project.deleted' as const;
export const PROJECT_ACCESS_CHANGED = 'projects.project.access_changed' as const;
export const PROJECT_SOURCE_BOUND = 'projects.project.source_bound' as const;
export const PROJECT_SOURCE_COMMIT_OBSERVED = 'projects.project.source_commit_observed' as const;

const projectCreatedEventWithoutSlugSchema = z.object({
  actorId: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  sourceConnectionId: nonEmptyStringSchema,
  sourceExternalRepositoryId: nonEmptyStringSchema,
});

const projectCreatedEventWithSlugSchema = projectCreatedEventWithoutSlugSchema.extend({
  slug: nonEmptyStringSchema,
});

export const projectCreatedEventSchema = z.union([
  projectCreatedEventWithSlugSchema,
  projectCreatedEventWithoutSlugSchema,
]);
export type ProjectCreatedEvent = z.infer<typeof projectCreatedEventWithSlugSchema>;

export const projectUpdatedEventSchema = z.object({
  actorId: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  slug: nonEmptyStringSchema,
});
export type ProjectUpdatedEvent = z.infer<typeof projectUpdatedEventSchema>;

const isoDateTimeSchema = z.string().datetime();

// A summary, not the policy: a project can list up to a thousand resources, and the audit trail
// keeps who changed what, not a copy of the lists.
export const projectAccessChangedEventSchema = z.object({
  actorId: nonEmptyStringSchema.max(255),
  workspaceId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  correlationId: nonEmptyStringSchema.max(255),
  occurredAt: isoDateTimeSchema,
  connections: z.union([
    z.literal('all'),
    z.array(
      z.object({
        connectionId: nonEmptyStringSchema,
        resources: z.union([z.literal('all'), z.object({count: z.number().int().nonnegative()})]),
      }),
    ),
  ]),
});
export type ProjectAccessChangedEvent = z.infer<typeof projectAccessChangedEventSchema>;

// Every module that owns project rows reacts to it, so it carries what a purge needs and nothing else.
export const projectDeletedEventSchema = z.object({
  workspaceId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  deletedBy: nonEmptyStringSchema.max(255),
  deletedAt: isoDateTimeSchema,
});
export type ProjectDeletedEvent = z.infer<typeof projectDeletedEventSchema>;

export const projectSourceBoundEventSchema = z.object({
  actorId: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  sourceConnectionId: nonEmptyStringSchema,
  provider: nonEmptyStringSchema,
  externalRepositoryId: nonEmptyStringSchema,
});
export type ProjectSourceBoundEvent = z.infer<typeof projectSourceBoundEventSchema>;

export const projectSourceCommitObservedEventSchema = z.object({
  workspaceId: nonEmptyStringSchema,
  projectId: nonEmptyStringSchema,
  sourceConnectionId: nonEmptyStringSchema,
  provider: nonEmptyStringSchema,
  externalRepositoryId: nonEmptyStringSchema,
  ref: nonEmptyStringSchema,
  headCommitSha: nonEmptyStringSchema,
});
export type ProjectSourceCommitObservedEvent = z.infer<
  typeof projectSourceCommitObservedEventSchema
>;

export interface ProjectsEventMap {
  [PROJECT_CREATED]: ProjectCreatedEvent;
  [PROJECT_UPDATED]: ProjectUpdatedEvent;
  [PROJECT_DELETED]: ProjectDeletedEvent;
  [PROJECT_ACCESS_CHANGED]: ProjectAccessChangedEvent;
  [PROJECT_SOURCE_BOUND]: ProjectSourceBoundEvent;
  [PROJECT_SOURCE_COMMIT_OBSERVED]: ProjectSourceCommitObservedEvent;
}

export const projectsEventSchemas = {
  [PROJECT_CREATED]: projectCreatedEventSchema,
  [PROJECT_UPDATED]: projectUpdatedEventSchema,
  [PROJECT_DELETED]: projectDeletedEventSchema,
  [PROJECT_ACCESS_CHANGED]: projectAccessChangedEventSchema,
  [PROJECT_SOURCE_BOUND]: projectSourceBoundEventSchema,
  [PROJECT_SOURCE_COMMIT_OBSERVED]: projectSourceCommitObservedEventSchema,
} satisfies Record<keyof ProjectsEventMap, z.ZodType>;
