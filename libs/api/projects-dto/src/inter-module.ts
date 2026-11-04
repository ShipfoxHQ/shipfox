import {slugSchema} from '@shipfox/api-common-dto';
import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {projectAccessPolicySchema} from './access.js';

const idSchema = z.string().uuid();
const projectSchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  sourceConnectionId: idSchema,
  sourceExternalRepositoryId: z.string(),
  sourceRepositoryOwner: z.string().min(1).nullable().optional(),
  sourceRepositoryName: z.string().min(1).nullable().optional(),
  sourceDefaultBranch: z.string().min(1).nullable().optional(),
  name: z.string(),
  isDefault: z.boolean(),
});
const projectCatalogSchema = projectSchema.extend({
  slug: slugSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const workspaceProjectCountSchema = z.object({
  workspaceId: idSchema,
  count: z.number().int().nonnegative(),
});
const adminProjectSchema = projectCatalogSchema
  .pick({
    id: true,
    workspaceId: true,
    name: true,
    slug: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({deletedAt: z.string().datetime().nullable()});
const projectLabelSchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: slugSchema,
  /** Set for a deleted project, which keeps its name and slug. */
  deletedAt: z.string().datetime().nullable(),
});
const projectCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: idSchema,
});
const checkoutTargetSchema = z.strictObject({project: idSchema});
const resolvedCheckoutTargetValue = z.strictObject({
  kind: z.literal('external-id'),
  externalRepositoryId: z.string(),
});
const resolvedCheckoutTargetSchema = z.object({
  projectId: idSchema,
  connectionId: idSchema,
  sourceRepositoryOwner: z.string().nullable(),
  sourceRepositoryName: z.string().nullable(),
  target: resolvedCheckoutTargetValue,
});

/** Producer-owned project lookup and workspace ownership operations. */
export const projectsInterModuleContract = defineInterModuleContract({
  module: 'projects',
  methods: {
    getProjectById: {
      input: z.object({projectId: idSchema}),
      output: z.object({project: projectSchema.nullable()}),
    },
    getProjectBySource: {
      input: z.object({
        workspaceId: idSchema,
        sourceConnectionId: idSchema,
        sourceExternalRepositoryId: z.string(),
      }),
      output: z.object({project: projectSchema.nullable()}),
    },
    findProjectBySourceRepositoryName: {
      input: z.object({
        workspaceId: idSchema,
        sourceConnectionId: idSchema,
        sourceRepositoryOwner: z.string().min(1),
        sourceRepositoryName: z.string().min(1),
      }),
      output: z.object({projects: z.array(projectSchema)}),
    },
    listProjectsByWorkspace: {
      input: z.object({
        workspaceId: idSchema,
        limit: z.number().int().min(1).max(100),
        cursor: projectCursorSchema.optional(),
      }),
      output: z.object({
        projects: z.array(projectSchema),
        nextCursor: projectCursorSchema.nullable(),
      }),
    },
    listProjectCatalogByWorkspace: {
      input: z.object({
        workspaceId: idSchema,
        limit: z.number().int().min(1).max(100),
        cursor: projectCursorSchema.optional(),
      }),
      output: z.object({
        projects: z.array(projectCatalogSchema),
        nextCursor: projectCursorSchema.nullable(),
      }),
    },
    /**
     * The name, slug, and deletion time of each project, for readers that hold project ids with no
     * live project behind them, such as usage. A deleted project is present only with
     * `includeDeleted`. Missing ids, and ids of another workspace, are absent from the result.
     */
    getProjectsByIds: {
      input: z.object({
        workspaceId: idSchema,
        projectIds: z.array(idSchema).min(1).max(100),
        includeDeleted: z.boolean().default(false),
      }),
      output: z.object({projects: z.array(projectLabelSchema)}),
    },
    /**
     * Lists projects across every workspace for administrator surfaces, newest
     * first, deleted projects included. Callers check the administrator role before calling.
     */
    listAdminProjects: {
      input: z.object({
        projectId: idSchema.optional(),
        search: z.string().min(1).max(100).optional(),
        limit: z.number().int().min(1).max(100),
        cursor: projectCursorSchema.optional(),
      }),
      output: z.object({
        projects: z.array(adminProjectSchema),
        nextCursor: projectCursorSchema.nullable(),
      }),
    },
    /**
     * The workspace's default project, which answers requests no other agent claims. Null for a
     * workspace the release backfill has not reached yet.
     */
    getDefaultProject: {
      input: z.object({workspaceId: idSchema}),
      output: z.object({project: projectSchema.nullable()}),
    },
    requireProjectForWorkspace: {
      input: z.object({projectId: idSchema, workspaceId: idSchema}),
      output: z.object({project: projectSchema}),
      errors: {
        'project-not-found': z.object({projectId: idSchema}),
        'project-workspace-mismatch': z.object({projectId: idSchema, workspaceId: idSchema}),
      },
    },
    getWorkspaceProjectCounts: {
      input: z.object({workspaceIds: z.array(idSchema).min(1).max(100)}),
      output: z.object({counts: z.array(workspaceProjectCountSchema)}),
    },
    /**
     * Moves a project's config source from `from` to `to` with a compare-and-set, and writes
     * `PROJECT_SOURCE_BOUND`. A repeat call that finds `to` already set succeeds with
     * `moved: false`.
     */
    moveProjectSource: {
      input: z.object({
        projectId: idSchema,
        workspaceId: idSchema,
        actorId: z.string().min(1),
        from: z.object({connectionId: idSchema, externalRepositoryId: z.string()}),
        to: z.object({
          connectionId: idSchema,
          provider: z.string().min(1),
          externalRepositoryId: z.string(),
          owner: z.string().min(1),
          name: z.string().min(1),
          defaultBranch: z.string().min(1),
        }),
      }),
      output: z.object({moved: z.boolean()}),
      errors: {
        'project-not-found': z.object({projectId: idSchema}),
        /** The project's source is neither `from` nor `to`. */
        'source-changed': z.object({projectId: idSchema}),
        /** Another project already owns `to`. */
        'source-already-bound': z.object({existingProjectId: idSchema}),
      },
    },
    /**
     * The project's access, as the input of the evaluators in this package. A project in another
     * workspace is indistinguishable from a missing one.
     */
    getProjectAccessPolicy: {
      input: z.object({workspaceId: idSchema, projectId: idSchema}),
      output: z.object({policy: projectAccessPolicySchema}),
      errors: {
        'project-not-found': z.object({projectId: idSchema}),
      },
    },
    /** Missing ids, and ids of another workspace, are absent from the result. */
    getProjectAccessPolicies: {
      input: z.object({
        workspaceId: idSchema,
        projectIds: z.array(idSchema).min(1).max(100),
      }),
      output: z.object({policies: z.array(projectAccessPolicySchema)}),
    },
    resolveCheckoutTarget: {
      input: z.object({
        workspaceId: idSchema,
        target: checkoutTargetSchema,
      }),
      output: resolvedCheckoutTargetSchema,
      errors: {
        'checkout-repository-not-authorized': z.object({}),
      },
    },
  },
});

export type ProjectsModuleClient = InterModuleClient<typeof projectsInterModuleContract>;
