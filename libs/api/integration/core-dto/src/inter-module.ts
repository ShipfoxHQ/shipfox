import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {isSafeRefInput} from '@shipfox/regex';
import {z} from 'zod';
import {integrationConnectionProviderAccessSchema} from './schemas/integrations.js';
import {
  CONFIG_COMMIT_MAX_CHANGES,
  CONFIG_COMMIT_MESSAGE_MAX_LENGTH,
  CONFIG_PATH_MAX_LENGTH,
  configFilePathSchema,
  configHistoryPathSchema,
  configMoveStatusSchema,
  configPullRequestStateSchema,
  configSourceKindSchema,
} from './schemas/project-config.js';

const id = z.string().uuid();
const connectionInactive = z.object({
  connectionId: id,
  providerAccess: integrationConnectionProviderAccessSchema.optional(),
});
const provider = z.string().min(1);
const capability = z.enum(['source_control', 'agent_tools', 'interaction']);
const safeRef = z.string().refine(isSafeRefInput, 'Ref contains a control character');
const connection = z.object({id, provider, slug: z.string().min(1)});
const workspaceConnectionCursor = z.object({slug: z.string().min(1), id});
const workspaceConnection = z.object({
  id,
  slug: z.string().min(1),
  provider,
  displayName: z.string(),
  lifecycleStatus: z.enum(['active', 'disabled', 'error']),
  capabilities: z.array(capability),
  externalUrl: z.string().url().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const connectionToolMethod = z.object({
  id: z.string().min(1),
  description: z.string(),
  sensitivity: z.enum(['read', 'write']),
  sensitive: z.boolean(),
});
const toolResultKind = z.enum(['json', 'file', 'image']);
const connectionTool = connectionToolMethod.extend({
  result: toolResultKind,
  methods: z.array(connectionToolMethod).optional(),
});
const connectionToolCatalogConnection = workspaceConnection.omit({
  externalUrl: true,
  createdAt: true,
  updatedAt: true,
});
const connectionById = z.object({
  id,
  workspaceId: id,
  provider,
  slug: z.string().min(1),
  displayName: z.string(),
  lifecycleStatus: z.enum(['active', 'disabled', 'error']),
});
const repository = z.object({
  externalRepositoryId: z.string(),
  owner: z.string(),
  name: z.string(),
  fullName: z.string(),
  defaultBranch: z.string(),
  visibility: z.enum(['public', 'private', 'internal', 'unknown']),
  cloneUrl: z.string(),
  htmlUrl: z.string(),
});
const triggerReference = z.object({
  externalRepositoryId: z.string(),
  ref: z.string(),
  commit: z.string(),
  actor: z.string().nullable(),
});
const sourceInput = z.object({workspaceId: id, connectionId: id, externalRepositoryId: z.string()});
// Checkout metadata must come from the provider response. Reject unknown fields
// such as caller-supplied clone URLs instead of silently stripping them.
const checkoutTargetValue = z.string().trim().min(1);
const checkoutTarget = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('external-id'), externalRepositoryId: checkoutTargetValue}).strict(),
  z
    .object({kind: z.literal('name'), owner: checkoutTargetValue, name: checkoutTargetValue})
    .strict(),
]);
const checkoutInput = z
  .object({
    workspaceId: id,
    connectionId: id,
    projectId: id.optional(),
    target: checkoutTarget.optional(),
    externalRepositoryId: z.string().min(1).optional(),
  })
  .strict();
const checkoutCredentialRenewal = z.discriminatedUnion('mode', [
  z.object({mode: z.literal('refresh-at'), refreshAt: z.string().datetime()}),
  z.object({mode: z.literal('on-rejection')}),
]);
const checkoutCredentials = z
  .object({
    username: z.string().min(1),
    token: z.string().min(1),
    expiresAt: z.string().datetime(),
    generation: z.string().min(1).optional(),
    renewal: checkoutCredentialRenewal.optional(),
  })
  .superRefine(({expiresAt, renewal}, ctx) => {
    if (renewal?.mode !== 'refresh-at') return;

    const refreshAt = Date.parse(renewal.refreshAt);
    if (refreshAt <= Date.now() || refreshAt >= Date.parse(expiresAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['renewal', 'refreshAt'],
        message: 'refreshAt must be in the future and earlier than expiresAt',
      });
    }
  });
const toolCallTool = z.object({
  id: z.string().min(1),
  provider,
  method: z.string().min(1).optional(),
  sensitivity: z.enum(['read', 'write']),
  sensitive: z.boolean(),
  requiredScope: z.array(z.unknown()),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  methods: z
    .array(
      z.object({
        id: z.string().min(1),
        token: z.string().min(1),
        description: z.string().min(1).optional(),
        sensitivity: z.enum(['read', 'write']),
        sensitive: z.boolean(),
        requiredScope: z.array(z.unknown()),
      }),
    )
    .min(1)
    .optional(),
});
const toolCallCaller = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('agent')}),
  z.object({
    kind: z.literal('tool_step'),
    projectId: z.string().min(1),
    runId: z.string().min(1),
    jobExecutionId: z.string().min(1),
    stepId: z.string().min(1),
    stepAttempt: z.number().int().nonnegative(),
    callIndex: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('conversation'),
    projectId: z.string().min(1),
    conversationId: z.string().min(1),
    turnId: z.string().min(1),
    callItemId: z.string().min(1),
    actorUserId: z.string().min(1).optional(),
  }),
]);
const toolCallOutcome = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('success'),
    result: z.record(z.string(), z.unknown()).nullable(),
    content: z.array(z.record(z.string(), z.unknown())),
  }),
  z.object({
    outcome: z.literal('error'),
    code: z.string().min(1),
    message: z.string(),
    retryAfterSeconds: z.number().int().positive().optional(),
    status: z.number().int().min(100).max(599).optional(),
  }),
]);
export const repositoryAuthorizationErrorCodes = {
  required: 'repository-required',
  notGranted: 'repository-not-granted',
  ambiguous: 'repository-ambiguous',
  storeUnavailable: 'repository-authorization-unavailable',
  targetInvalid: 'repository-authorization-target-invalid',
} as const;
const repositoryAuthorizationDetails = z.object({
  workspaceId: id.optional(),
  connectionId: id.optional(),
  target: checkoutTarget.optional(),
});
const repositoryAuthorizationErrors = {
  [repositoryAuthorizationErrorCodes.required]: repositoryAuthorizationDetails,
  [repositoryAuthorizationErrorCodes.notGranted]: repositoryAuthorizationDetails,
  [repositoryAuthorizationErrorCodes.ambiguous]: repositoryAuthorizationDetails,
  [repositoryAuthorizationErrorCodes.storeUnavailable]: repositoryAuthorizationDetails,
  [repositoryAuthorizationErrorCodes.targetInvalid]: repositoryAuthorizationDetails,
};
const toolCallErrors = {
  'connection-not-found': z.object({connectionId: id}),
  'connection-inactive': connectionInactive,
  'connection-workspace-mismatch': z.object({connectionId: id}),
  'connection-provider-changed': z.object({connectionId: id}),
  'provider-unavailable': z.object({provider}),
  'capability-unavailable': z.object({provider, capability}),
  ...repositoryAuthorizationErrors,
};
// Longest provider explanation that crosses the module boundary.
export const PROVIDER_MESSAGE_MAX_LENGTH = 500;
const providerError = z.object({
  reason: z.string(),
  retryAfterSeconds: z.number().int().positive().optional(),
  providerMessage: z.string().max(PROVIDER_MESSAGE_MAX_LENGTH).optional(),
  providerStatus: z.number().int().min(100).max(599).optional(),
});
const sourceErrors = {
  'connection-not-found': z.object({connectionId: id}),
  'connection-inactive': connectionInactive,
  'connection-workspace-mismatch': z.object({connectionId: id}),
  'provider-unavailable': z.object({provider}),
  'capability-unavailable': z.object({provider, capability}),
  'checkout-unsupported': z.object({provider}),
  'provider-failure': providerError,
};
const interactionErrors = {
  'connection-not-found': z.object({connectionId: id}),
  'connection-inactive': connectionInactive,
  'connection-workspace-mismatch': z.object({connectionId: id}),
  'provider-unavailable': z.object({provider}),
  'capability-unavailable': z.object({provider, capability}),
  'provider-failure': providerError,
};
const interactionRole = z.enum(['request', 'follow_up', 'stop']);
const interactionConversation = z.object({
  workspaceId: id,
  connectionId: id,
  conversationKey: z.string().min(1),
});
const interaction = z.object({
  conversationKey: z.string().min(1),
  role: interactionRole,
  context: z.record(z.string(), z.unknown()),
  author: z.object({externalId: z.string().min(1), displayName: z.string().optional()}).optional(),
  text: z.string(),
});
const configReadErrors = {
  'project-not-found': z.object({projectId: id}),
  'connection-not-found': z.object({connectionId: id}),
  'connection-inactive': connectionInactive,
  'connection-workspace-mismatch': z.object({connectionId: id}),
  'provider-unavailable': z.object({provider}),
  'capability-unavailable': z.object({provider, capability}),
  'provider-failure': providerError,
};
const configInput = z.object({workspaceId: id, projectId: id});
// Omitting the ref reads the default branch.
const configRef = z.object({ref: safeRef.min(1).optional()});
const checkoutErrors = {
  ...sourceErrors,
  ...repositoryAuthorizationErrors,
};

const refErrors = {
  ...sourceErrors,
  'ref-not-found': z.object({ref: safeRef}),
  'ref-invalid': z.object({ref: safeRef}),
};

const managedSeedFile = z.object({path: z.string(), content: z.string()});
const managedSeedFileProblem = z.enum([
  'path-not-allowed',
  'file-too-large',
  'too-many-files',
  'seed-too-large',
]);

/** Producer-owned synchronous operations for the Integrations bounded context. */
export const integrationsInterModuleContract = defineInterModuleContract({
  module: 'integrations',
  methods: {
    resolveSourceRepository: {
      input: sourceInput,
      output: z.object({connection, repository}),
      errors: sourceErrors,
    },
    /**
     * Creates the managed repository of a project, and the workspace's hidden connection on first
     * use. Idempotent on `projectId`: a repeat call ignores `files` and returns the same repository.
     */
    createManagedRepository: {
      input: z.object({workspaceId: id, projectId: id, files: z.array(managedSeedFile).optional()}),
      output: z.object({connectionId: id, externalRepositoryId: z.string()}),
      errors: {
        'invalid-seed-file': z.object({problem: managedSeedFileProblem, path: z.string()}),
        'project-conflict': z.object({projectId: id}),
      },
    },
    /** Deletes the managed repository of a project, with its objects and refs. */
    deleteManagedRepository: {
      input: z.object({workspaceId: id, projectId: id}),
      output: z.object({deleted: z.boolean()}),
    },
    resolveConnection: {
      input: z.object({workspaceId: id, slug: z.string().min(1)}),
      output: connection.nullable(),
    },
    /**
     * The workspace's only active source-control connection. Null when it has none or several,
     * which is when a managed project has no default connection.
     */
    resolveSourceControlConnection: {
      input: z.object({workspaceId: id}),
      output: connection.nullable(),
    },
    resolveConnectionById: {
      input: z.object({connectionId: id}),
      output: connectionById.nullable(),
    },
    resolveTriggerReference: {
      input: z.object({workspaceId: id, connectionId: id, payload: z.unknown()}),
      output: triggerReference.nullable(),
      errors: sourceErrors,
    },
    resolveSourceRef: {
      input: sourceInput.extend({ref: safeRef}),
      output: z.object({ref: z.string(), commit: z.string()}),
      errors: refErrors,
    },
    listSourceFiles: {
      input: sourceInput.extend({
        ref: z.string(),
        prefix: z.string(),
        limit: z.number().int().positive(),
        cursor: z.string().optional(),
      }),
      output: z.object({
        files: z.array(
          z.object({
            path: z.string(),
            type: z.enum(['file', 'symlink', 'submodule']),
            size: z.number().int().nullable(),
          }),
        ),
        nextCursor: z.string().nullable(),
      }),
      errors: sourceErrors,
    },
    fetchSourceFile: {
      input: sourceInput.extend({ref: z.string(), path: z.string()}),
      output: z.object({path: z.string(), ref: z.string(), content: z.string()}),
      errors: sourceErrors,
    },
    /** Where a project's config lives. Reads the project row, so it still answers during a provider outage. */
    getConfigSource: {
      input: configInput,
      output: z.object({
        source: z.object({
          kind: configSourceKindSchema,
          provider,
          connectionId: id,
          externalRepositoryId: z.string(),
          owner: z.string().nullable(),
          name: z.string().nullable(),
          defaultBranch: z.string(),
        }),
        head: z.object({ref: z.string(), commit: z.string()}).nullable(),
        historySupported: z.boolean(),
        move: z
          .object({
            status: configMoveStatusSchema,
            target: z.object({
              connectionId: id,
              externalRepositoryId: z.string(),
              fullName: z.string().nullable(),
            }),
            startedBy: z.string().nullable(),
            startedAt: z.string().datetime().nullable(),
          })
          .nullable(),
        pullRequest: z
          .object({
            url: z.string(),
            number: z.number().int(),
            state: z.union([configPullRequestStateSchema, z.literal('unknown')]),
          })
          .nullable(),
      }),
      errors: configReadErrors,
    },
    /** Lists the files under `.shipfox/` at one commit of the project's active repo. */
    listConfigFiles: {
      input: configInput.extend(configRef.shape).extend({
        limit: z.number().int().positive(),
        cursor: z.string().optional(),
      }),
      output: z.object({
        commit: z.string(),
        files: z.array(
          z.object({
            path: z.string(),
            type: z.enum(['file', 'symlink', 'submodule']),
            size: z.number().int().nullable(),
          }),
        ),
        nextCursor: z.string().nullable(),
      }),
      errors: configReadErrors,
    },
    readConfigFile: {
      input: configInput.extend(configRef.shape).extend({path: configFilePathSchema}),
      output: z.object({path: z.string(), commit: z.string(), content: z.string()}),
      errors: configReadErrors,
    },
    /** Lists the commits that changed a path, newest first. Needs a provider that keeps history. */
    listConfigCommits: {
      input: configInput.extend(configRef.shape).extend({
        path: configHistoryPathSchema,
        limit: z.number().int().positive(),
        cursor: z.string().optional(),
      }),
      output: z.object({
        commit: z.string(),
        commits: z.array(
          z.object({
            oid: z.string(),
            message: z.string(),
            authorName: z.string(),
            authoredAt: z.string().datetime(),
            htmlUrl: z.string().optional(),
          }),
        ),
        nextCursor: z.string().nullable(),
      }),
      errors: {...configReadErrors, 'history-unsupported': z.object({provider})},
    },
    /**
     * Commits several file changes to a branch of a managed project's repository. The first commit
     * creates the branch from the default branch, and `expectedHead` guards later ones. The default
     * branch is refused, and so is a linked repository.
     */
    commitConfigChanges: {
      input: configInput.extend({
        branch: safeRef.min(1),
        expectedHead: z
          .string()
          .regex(/^[0-9a-f]{40}$/u)
          .optional(),
        message: z.string().min(1).max(CONFIG_COMMIT_MESSAGE_MAX_LENGTH),
        /** A `null` content deletes the file. */
        changes: z
          .array(
            z.object({
              path: z.string().max(CONFIG_PATH_MAX_LENGTH),
              content: z.string().nullable(),
            }),
          )
          .max(CONFIG_COMMIT_MAX_CHANGES),
        /** Who the commit is attributed to. */
        actor: z.object({id, name: z.string().min(1)}),
      }),
      output: z.object({branch: z.string(), commit: z.string(), parent: z.string()}),
      errors: {
        ...configReadErrors,
        /** The config lives in a linked repository, named `owner/name`. */
        'repository-read-only': z.object({repository: z.string()}),
        'protected-branch': z.object({branch: z.string()}),
        'branch-invalid': z.object({branch: z.string()}),
        /** `head` is where the branch points now, or null when it does not exist. */
        'stale-head': z.object({branch: z.string(), head: z.string().nullable()}),
        'path-not-allowed': z.object({path: z.string()}),
        'content-not-text': z.object({path: z.string()}),
        'file-too-large': z.object({path: z.string()}),
        'file-not-found': z.object({path: z.string()}),
        'too-many-changes': z.object({}),
        'commit-too-large': z.object({}),
        'no-changes': z.object({}),
      },
    },
    createCheckoutSpec: {
      input: checkoutInput
        .extend({
          ref: z.string().optional(),
          permissions: z.object({contents: z.enum(['read', 'write'])}).optional(),
        })
        .superRefine(requireCheckoutTarget),
      output: z.object({
        repositoryUrl: z.string(),
        ref: z.string(),
        target: checkoutTarget,
        credentials: checkoutCredentials.optional(),
        gitAuthor: z.object({name: z.string(), email: z.string()}).optional(),
      }),
      errors: checkoutErrors,
    },
    createCheckoutCredentials: {
      input: checkoutInput
        .extend({
          permissions: z.object({contents: z.enum(['read', 'write'])}),
          rejectedGeneration: z.string().optional(),
        })
        .superRefine(requireCheckoutTarget),
      output: checkoutCredentials,
      errors: checkoutErrors,
    },
    listConnectionsByWorkspace: {
      input: z.object({
        workspaceId: id,
        capability: capability.optional(),
        limit: z.number().int().min(1).max(100),
        cursor: workspaceConnectionCursor.optional(),
      }),
      output: z.object({
        connections: z.array(workspaceConnection),
        nextCursor: workspaceConnectionCursor.nullable(),
      }),
    },
    getConnectionToolCatalog: {
      input: z.object({workspaceId: id, connectionId: id}),
      output: z
        .object({
          connection: connectionToolCatalogConnection,
          tools: z.array(connectionTool),
          events: z.array(z.string()),
        })
        .nullable(),
    },
    /** The tools to offer a conversation. Each entry is a valid `callTool` input `tool`. */
    listConversationTools: {
      input: z.object({}),
      output: z.object({tools: z.array(toolCallTool.extend({description: z.string()}))}),
    },
    getAgentToolsContext: {
      input: z.object({workspaceId: id, defaultConnectionId: id}),
      output: z.object({
        selectionCatalogs: z.array(
          z.object({
            provider,
            selectors: z.array(
              z.object({
                token: z.string(),
                kind: z.enum(['family', 'family_wildcard', 'method', 'standalone']),
                sensitivity: z.enum(['read', 'write']),
                sensitive: z.boolean(),
              }),
            ),
          }),
        ),
        catalogs: z.array(
          z.object({
            provider,
            tools: z.array(
              z.object({
                id: z.string(),
                description: z.string(),
                sensitivity: z.enum(['read', 'write']),
                sensitive: z.boolean(),
                requiredScope: z.unknown(),
                inputSchema: z.record(z.string(), z.unknown()),
                outputSchema: z.record(z.string(), z.unknown()).optional(),
                result: toolResultKind,
                indirectTargetNote: z.string().min(1).optional(),
                methods: z
                  .array(
                    z.object({
                      id: z.string(),
                      description: z.string(),
                      sensitivity: z.enum(['read', 'write']),
                      sensitive: z.boolean(),
                      requiredScope: z.unknown(),
                      indirectTargetNote: z.string().min(1).optional(),
                    }),
                  )
                  .optional(),
              }),
            ),
          }),
        ),
        workspaceConnections: z.array(
          z.object({slug: z.string(), id, provider, capabilities: z.array(capability)}),
        ),
        eventCatalogs: z.array(z.object({provider, events: z.array(z.string())})),
        fixedEventProviders: z.array(provider),
        defaultConnection: z.object({id, slug: z.string(), provider}).nullable(),
      }),
      errors: sourceErrors,
    },
    /** Lists the tool and event references of a composed template this instance cannot serve. */
    checkTemplateConformance: {
      input: z.object({
        workflow: z.string(),
        bindings: z.record(z.string().min(1), provider),
      }),
      output: z.object({issues: z.array(z.string())}),
    },
    callTool: {
      input: z.object({
        workspaceId: id,
        connectionId: id,
        tool: toolCallTool,
        arguments: z.record(z.string(), z.unknown()),
        caller: toolCallCaller,
      }),
      output: toolCallOutcome,
      errors: toolCallErrors,
    },
    /** What each provider with the interaction capability accepts, for definition sync and prompts. */
    listInteractionProviders: {
      input: z.object({}),
      output: z.object({
        providers: z.array(
          z.object({
            provider,
            interactionEvents: z.record(z.string().min(1), interactionRole),
            requestContextSchema: z.record(z.string(), z.unknown()),
            replyGuidance: z.string(),
          }),
        ),
      }),
    },
    /** Null when the event isn't meant for an agent, including an event the provider doesn't list. */
    readInteraction: {
      input: z.object({
        workspaceId: id,
        connectionId: id,
        event: z.string().min(1),
        payload: z.unknown(),
      }),
      output: interaction.nullable(),
      errors: interactionErrors,
    },
    sendInteractionReply: {
      input: interactionConversation.extend({
        replyId: z.string().min(1),
        kind: z.enum(['response', 'error']),
        text: z.string(),
        agent: z.object({name: z.string().min(1)}),
      }),
      output: z.discriminatedUnion('outcome', [
        z.object({outcome: z.literal('delivered')}),
        z.object({outcome: z.literal('undeliverable'), reason: z.string()}),
      ]),
      errors: interactionErrors,
    },
    /** `reported` is false when the provider can't show progress. */
    reportInteractionProgress: {
      input: interactionConversation.extend({
        state: z.enum(['working', 'idle']),
        detail: z.string().optional(),
        links: z.array(z.object({label: z.string(), url: z.string().url()})).optional(),
      }),
      output: z.object({reported: z.boolean()}),
      errors: interactionErrors,
    },
  },
});

function requireCheckoutTarget(
  input: {
    target?: z.infer<typeof checkoutTarget> | undefined;
    externalRepositoryId?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  // This stays at the JSON boundary so malformed checkout payloads are rejected
  // before they reach the SPI normalizer used by in-memory callers.
  if (input.target === undefined && input.externalRepositoryId === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['target'],
      message: 'Checkout input requires a target or an external repository id',
    });
  }
  if (input.target !== undefined && input.externalRepositoryId !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['target'],
      message: 'Checkout input cannot include both a target and an external repository id',
    });
  }
}

export type IntegrationsModuleClient = InterModuleClient<typeof integrationsInterModuleContract>;
