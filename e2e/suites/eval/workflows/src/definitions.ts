import type {DefinitionResponseDto} from '@shipfox/api-definitions-dto';
import type {FireManualTriggerResponseDto} from '@shipfox/api-triggers-dto';
import {type createApiClient, pollUntil} from '@shipfox/e2e-core';

export const START_TIMEOUT_MS = 60_000;

/** A definition with a file path is a repository definition, which is how Shipfox names a workflow. */
export async function createDefinition({
  client,
  projectId,
  yaml,
  file,
}: {
  client: ReturnType<typeof createApiClient>;
  projectId: string;
  yaml: string;
  file?: {path: string; ref: string} | undefined;
}): Promise<DefinitionResponseDto> {
  return await client.requestJson<DefinitionResponseDto>('post', '/definitions', {
    json: {
      project_id: projectId,
      yaml,
      ...(file === undefined
        ? {source: 'manual'}
        : {source: 'vcs', config_path: file.path, ref: file.ref}),
    },
  });
}

export async function fireManual({
  client,
  definitionId,
  inputs,
  timeoutMs = START_TIMEOUT_MS,
  signal,
}: {
  client: ReturnType<typeof createApiClient>;
  definitionId: string;
  inputs: Record<string, unknown>;
  /** Bounds the wait for the trigger to accept the run. */
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
}): Promise<string> {
  const response = await pollUntil<FireManualTriggerResponseDto>(
    {
      timeoutMs,
      intervalMs: 250,
      maxIntervalMs: 4_000,
      backoffFactor: 1.5,
      describe: () => `manual trigger of definition ${definitionId}`,
      ...(signal === undefined ? {} : {signal}),
    },
    async () =>
      await client.requestJson<FireManualTriggerResponseDto>(
        'post',
        `/workflow-definitions/${definitionId}/fire-manual`,
        {json: {inputs}},
      ),
  );
  return response.workflow_run_id;
}
