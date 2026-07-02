import {setTimeout as sleep} from 'node:timers/promises';
import type {DefinitionDto, DefinitionListResponseDto} from '@shipfox/api-definitions-dto';
import {type ApiFetch, createApiClient} from '@shipfox/e2e-core';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_INITIAL_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 4_000;
const DEFAULT_BACKOFF_FACTOR = 1.5;

type DefinitionSelector =
  | {
      configPath: string;
      definitionId?: never;
    }
  | {
      configPath?: never;
      definitionId: string;
    };

export type WaitForDefinitionOptions = DefinitionSelector & {
  apiUrl?: string | undefined;
  backoffFactor?: number | undefined;
  fetch?: ApiFetch | undefined;
  initialDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  projectId: string;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  token: string;
};

function nextDelay(currentDelayMs: number, options: WaitForDefinitionOptions): number {
  const factor = options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  return Math.min(Math.ceil(currentDelayMs * factor), maxDelayMs);
}

function assertDefinitionSelector(options: WaitForDefinitionOptions): void {
  if (!options.configPath && !options.definitionId) {
    throw new Error('waitForDefinition requires configPath or definitionId');
  }
}

function matchesDefinition(definition: DefinitionDto, selector: DefinitionSelector): boolean {
  if (selector.definitionId) return definition.id === selector.definitionId;
  return definition.config_path === selector.configPath;
}

function selectorLabel(selector: DefinitionSelector): string {
  if (selector.definitionId) return `definitionId=${selector.definitionId}`;
  return `configPath=${selector.configPath}`;
}

function formatObserved(response: DefinitionListResponseDto | null, selector: DefinitionSelector) {
  if (!response) return 'no definitions response observed';
  const definitions = response.definitions
    .slice(0, 5)
    .map((definition) =>
      [
        `id=${definition.id}`,
        `configPath=${definition.config_path ?? 'null'}`,
        `source=${definition.source}`,
        `fetchedAt=${definition.fetched_at}`,
      ].join(' '),
    );
  const more = response.definitions.length > definitions.length ? ', ...' : '';
  const sync = response.sync
    ? [
        `syncStatus=${response.sync.status}`,
        `syncRef=${response.sync.ref ?? 'null'}`,
        `syncErrorCode=${response.sync.last_error_code ?? 'null'}`,
        `syncErrorMessage=${response.sync.last_error_message ?? 'null'}`,
      ].join(' ')
    : 'sync=null';
  return `${selectorLabel(selector)} ${sync} definitions=[${definitions.join(', ')}${more}]`;
}

async function waitForNextPoll(params: {
  delayMs: number;
  deadline: number;
  signal?: AbortSignal | undefined;
}): Promise<void> {
  const remainingMs = params.deadline - Date.now();
  if (remainingMs <= 0) return;
  await sleep(Math.min(params.delayMs, remainingMs), undefined, {signal: params.signal});
}

export async function waitForDefinition(options: WaitForDefinitionOptions): Promise<DefinitionDto> {
  assertDefinitionSelector(options);
  const selector = {
    configPath: options.configPath,
    definitionId: options.definitionId,
  } as DefinitionSelector;
  const client = createApiClient({
    apiUrl: options.apiUrl,
    fetch: options.fetch,
    token: options.token,
  });
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let delayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  let lastResponse: DefinitionListResponseDto | null = null;

  while (Date.now() <= deadline) {
    options.signal?.throwIfAborted();
    const params = new URLSearchParams({project_id: options.projectId, limit: '100'});
    lastResponse = await client.requestJson<DefinitionListResponseDto>(
      'get',
      `/definitions?${params}`,
      {
        signal: options.signal,
      },
    );

    if (lastResponse.sync?.status === 'failed') {
      throw new Error(
        `Definition sync failed while waiting: ${formatObserved(lastResponse, selector)}`,
      );
    }

    const definition = lastResponse.definitions.find((candidate) =>
      matchesDefinition(candidate, selector),
    );
    if (definition) return definition;

    await waitForNextPoll({deadline, delayMs, signal: options.signal});
    delayMs = nextDelay(delayMs, options);
  }

  throw new Error(`Timed out waiting for definition: ${formatObserved(lastResponse, selector)}`);
}

export function createDefinitionsHelper(options: {
  apiUrl?: string | undefined;
  fetch?: ApiFetch | undefined;
  token: string;
}) {
  return {
    waitForDefinition: (params: Omit<WaitForDefinitionOptions, 'apiUrl' | 'fetch' | 'token'>) =>
      waitForDefinition({...options, ...params} as WaitForDefinitionOptions),
  };
}

export type DefinitionsHelper = ReturnType<typeof createDefinitionsHelper>;
