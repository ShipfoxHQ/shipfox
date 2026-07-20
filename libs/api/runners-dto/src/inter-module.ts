import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {runnerToolCapabilitiesSchema} from '#schemas/tool-capabilities.js';

const idSchema = z.string().uuid();

export const runnersInterModuleContract = defineInterModuleContract({
  module: 'runners',
  methods: {
    enqueueJobExecution: {
      input: z.object({
        workspaceId: idSchema,
        workflowRunId: idSchema,
        workflowRunAttemptId: idSchema,
        jobId: idSchema,
        jobExecutionId: idSchema,
        projectId: idSchema,
        requiredLabels: z.array(z.string()),
      }),
      output: z.object({}),
      errors: {
        'empty-required-labels': z.object({}),
      },
    },
    releaseJobExecution: {
      input: z.object({jobExecutionId: idSchema}),
      output: z.object({}),
    },
    cancelJobs: {
      input: z.object({jobIds: z.array(idSchema)}),
      output: z.object({}),
    },
    getLeaseState: {
      input: z.object({
        jobId: idSchema,
        jobExecutionId: idSchema,
        runnerSessionId: idSchema,
      }),
      output: z.object({active: z.boolean()}),
    },
    getEffectiveRunnerToolCapabilities: {
      input: z.object({runnerSessionId: idSchema}),
      output: z.object({
        capabilities: runnerToolCapabilitiesSchema,
        reportFresh: z.boolean(),
      }),
    },
  },
});

export type RunnersInterModuleClient = InterModuleClient<typeof runnersInterModuleContract>;
