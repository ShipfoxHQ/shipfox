import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {
  materializedSecretBindingSchema,
  type StepSecretDto,
  stepSecretsParamsSchema,
  stepSecretsQuerySchema,
  stepSecretsResponseSchema,
} from '@shipfox/api-secrets-dto';
import {
  type SecretsInterModuleClient,
  secretsInterModuleContract,
} from '@shipfox/api-secrets-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {captureException} from '@shipfox/node-error-monitoring';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {ZodError, z} from 'zod';
import {loadRunningLeasedStep} from './leased-step.js';

const secretBindingsSchema = z.array(materializedSecretBindingSchema);

export function createGetStepSecretsRoute(
  runners: RunnersInterModuleClient,
  secretsClient: SecretsInterModuleClient,
) {
  return defineRoute({
    method: 'GET',
    path: '/steps/:stepId/secrets',
    description:
      "Returns decrypted secret values referenced by the runner's currently leased running run step. The job scope and secret bindings are re-derived from server state; the runner supplies only the step id and current attempt.",
    schema: {
      params: stepSecretsParamsSchema,
      querystring: stepSecretsQuerySchema,
      response: {
        200: stepSecretsResponseSchema,
      },
    },
    errorHandler: (error) => {
      if (isInterModuleKnownError(secretsInterModuleContract.methods.getSecret, error)) {
        captureException(error);
        throw new ClientError('Step secret could not be decrypted', 'secret-value-invalid', {
          status: 409,
          cause: error,
        });
      }
      throw error;
    },
    handler: async (request, reply) => {
      const {stepId} = request.params;
      const {attempt} = request.query;
      const {leasedJob, step, workspaceId, projectId, secretInputs} = await loadRunningLeasedStep({
        runners,
        request,
        stepId,
        attempt,
      });

      if (step.type !== 'run') {
        throw new ClientError('Step is not a run step', 'step-not-run', {status: 409});
      }

      const secretBindings = parseSecretBindings(step.config.secret_bindings);
      const references = distinctSecretReferences(secretBindings);
      const secrets = await Promise.all(
        references.map(async (reference): Promise<StepSecretDto> => {
          if (reference.store === 'inputs') {
            const source = secretInputs?.[reference.key];
            if (!source) {
              throw new ClientError(
                `Secret input ${reference.key} was not supplied`,
                'secret-input-missing',
                {status: 422},
              );
            }

            const {value} = await secretsClient.getSecret({
              workspaceId,
              projectId: source.projectId,
              namespace: '',
              key: source.key,
              store: source.store,
              exactScope: true,
            });
            if (value === null) {
              throw new ClientError(
                `Secret input ${reference.key} has no source`,
                'secret-not-found',
                {status: 422},
              );
            }
            return {...reference, value};
          }

          const {value} = await secretsClient.getSecret({
            workspaceId,
            projectId,
            namespace: '',
            key: reference.key,
            store: reference.store,
          });
          if (value === null) {
            throw new ClientError('Secret not found', 'secret-not-found', {status: 422});
          }
          return {...reference, value};
        }),
      );

      const secretInputSources = references.flatMap((reference) => {
        if (reference.store !== 'inputs') return [];
        const source = secretInputs?.[reference.key];
        return source === undefined ? [] : [{inputName: reference.key, sourceKey: source.key}];
      });
      logger().info(
        {
          jobId: leasedJob.jobId,
          workspaceId,
          stepId,
          keyCount: references.length,
          secretInputSources,
        },
        'Resolved step secrets',
      );
      logger().debug(
        {
          jobId: leasedJob.jobId,
          workspaceId,
          stepId,
          keys: references.map((ref) => ref.key),
          secretInputSources,
        },
        'Resolved step secret keys',
      );

      reply.header('cache-control', 'no-store');
      return {secrets};
    },
  });
}

function parseSecretBindings(value: unknown): z.infer<typeof secretBindingsSchema> {
  try {
    return secretBindingsSchema.parse(value ?? []);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ClientError('Step secret bindings are invalid', 'secret-bindings-invalid', {
        status: 409,
        cause: error,
      });
    }
    throw error;
  }
}

function distinctSecretReferences(
  bindings: ReadonlyArray<z.infer<typeof materializedSecretBindingSchema>>,
): Array<Pick<StepSecretDto, 'store' | 'key'>> {
  const seen = new Set<string>();
  const references: Array<Pick<StepSecretDto, 'store' | 'key'>> = [];
  for (const binding of bindings) {
    for (const segment of binding.segments) {
      if (segment.kind !== 'secret') continue;
      const id = secretReferenceId(segment);
      if (seen.has(id)) continue;
      seen.add(id);
      references.push({store: segment.store, key: segment.key});
    }
  }
  return references;
}

function secretReferenceId(reference: Pick<StepSecretDto, 'store' | 'key'>): string {
  return `${reference.store}\0${reference.key}`;
}
