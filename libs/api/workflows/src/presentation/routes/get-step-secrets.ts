import {getSecret, SecretDecryptionError} from '@shipfox/api-secrets';
import {
  materializedSecretBindingSchema,
  type StepSecretDto,
  stepSecretsParamsSchema,
  stepSecretsQuerySchema,
  stepSecretsResponseSchema,
} from '@shipfox/api-secrets-dto';
import {captureException} from '@shipfox/node-error-monitoring';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {ZodError, z} from 'zod';
import {loadRunningLeasedStep} from './leased-step.js';

const secretBindingsSchema = z.array(materializedSecretBindingSchema);

export const getStepSecretsRoute = defineRoute({
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
    if (error instanceof SecretDecryptionError) {
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
    const {leasedJob, step, workspaceId, projectId} = await loadRunningLeasedStep({
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
        const value = await getSecret({
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

    logger().info(
      {jobId: leasedJob.jobId, workspaceId, stepId, keyCount: references.length},
      'Resolved step secrets',
    );
    logger().debug(
      {jobId: leasedJob.jobId, workspaceId, stepId, keys: references.map((ref) => ref.key)},
      'Resolved step secret keys',
    );

    reply.header('cache-control', 'no-store');
    return {secrets};
  },
});

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
