import {
  type FoxlangExecutionResponseDto,
  type FoxlangFakeMonitoringAlertRequestDto,
  type FoxlangRunDetailResponseDto,
  type FoxlangRunListResponseDto,
  type FoxlangWorkflowDetailResponseDto,
  type FoxlangWorkflowListResponseDto,
  foxlangExecutionResponseSchema,
  foxlangLocalServiceErrorResponseSchema,
  foxlangRunDetailResponseSchema,
  foxlangRunListResponseSchema,
  foxlangWorkflowDetailResponseSchema,
  foxlangWorkflowListResponseSchema,
  type LocalWorkflowServiceErrorCodeDto,
} from '@shipfox/api-local-workflows-dto';
import type {z} from 'zod';

export const DEFAULT_LOCAL_SERVICE_BASE_URL = 'http://127.0.0.1:8765';
export const DEFAULT_LOCAL_SERVICE_TIMEOUT_MS = 3_000;

const SETUP_HINT =
  'Register workflows with foxlang-v0-register-workflows before using the platform fake alert flow.';

export interface LocalWorkflowsServiceOptions {
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
  runIdFactory?: (() => string) | undefined;
}

export interface LocalWorkflowsStatus {
  base_url: string;
  reachable: boolean;
  latest_fake_alert: FoxlangExecutionResponseDto | null;
  setup_hint: string | null;
}

export interface LocalWorkflowsService {
  readonly baseUrl: string;
  getStatus(): Promise<LocalWorkflowsStatus>;
  listWorkflows(): Promise<FoxlangWorkflowListResponseDto>;
  getWorkflow(workflowId: string): Promise<FoxlangWorkflowDetailResponseDto>;
  listRuns(): Promise<FoxlangRunListResponseDto>;
  getRun(runId: string): Promise<FoxlangRunDetailResponseDto>;
  triggerFakeAlert(
    alert: Omit<FoxlangFakeMonitoringAlertRequestDto, 'run_id'>,
  ): Promise<{run_id: string; result: FoxlangExecutionResponseDto}>;
}

export class LocalWorkflowsError extends Error {
  readonly code: LocalWorkflowServiceErrorCodeDto;
  readonly status: number;
  readonly details: unknown;

  constructor(params: {
    message: string;
    code: LocalWorkflowServiceErrorCodeDto;
    status: number;
    details?: unknown;
  }) {
    super(params.message);
    this.name = 'LocalWorkflowsError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
  }
}

export function createLocalWorkflowsService(
  options: LocalWorkflowsServiceOptions = {},
): LocalWorkflowsService {
  const baseUrl =
    options.baseUrl ?? process.env.LOCAL_WORKFLOWS_SERVICE_URL ?? DEFAULT_LOCAL_SERVICE_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCAL_SERVICE_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const runIdFactory =
    options.runIdFactory ??
    (() =>
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `local-workflows-${crypto.randomUUID()}`
        : `local-workflows-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let latestFakeAlert: FoxlangExecutionResponseDto | null = null;

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, baseUrl), {
        ...init,
        headers: {
          ...(init.body ? {'content-type': 'application/json'} : {}),
          ...init.headers,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new LocalWorkflowsError({
          message: 'Local workflows service request timed out',
          code: 'local-service-timeout',
          status: 504,
          details: {path, timeout_ms: timeoutMs},
        });
      }
      throw new LocalWorkflowsError({
        message: 'Local workflows service is unavailable',
        code: 'local-service-unavailable',
        status: 503,
        details: {path},
      });
    } finally {
      clearTimeout(timeout);
    }

    const parsed = await parseJson(response, path);
    throwIfLocalServiceError(response, parsed);

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new LocalWorkflowsError({
        message: 'Local workflows service returned an unexpected response',
        code: 'local-service-malformed-response',
        status: 502,
        details: {path, issues: result.error.issues},
      });
    }

    return result.data;
  }

  return {
    baseUrl,
    async getStatus() {
      try {
        await request('/v0/foxlang/workflows', foxlangWorkflowListResponseSchema);
        return {
          base_url: baseUrl,
          reachable: true,
          latest_fake_alert: latestFakeAlert,
          setup_hint:
            latestFakeAlert?.status === 'input_rejected' ||
            latestFakeAlert?.status === 'source_invalid'
              ? SETUP_HINT
              : null,
        };
      } catch (error) {
        if (error instanceof LocalWorkflowsError) {
          return {
            base_url: baseUrl,
            reachable: false,
            latest_fake_alert: latestFakeAlert,
            setup_hint:
              error.code === 'local-service-unavailable' || error.code === 'local-service-timeout'
                ? 'Start the Foxlang V0 Local Service on the configured base URL.'
                : SETUP_HINT,
          };
        }
        throw error;
      }
    },
    listWorkflows: () => request('/v0/foxlang/workflows', foxlangWorkflowListResponseSchema),
    async getWorkflow(workflowId) {
      assertSafeOpaqueId(workflowId, 'workflow id');
      return await request(
        `/v0/foxlang/workflows/${workflowId}`,
        foxlangWorkflowDetailResponseSchema,
      );
    },
    listRuns: () => request('/v0/foxlang/runs', foxlangRunListResponseSchema),
    async getRun(runId) {
      assertSafeOpaqueId(runId, 'run id');
      return await request(`/v0/foxlang/runs/${runId}`, foxlangRunDetailResponseSchema);
    },
    async triggerFakeAlert(alert) {
      const runId = runIdFactory();
      const result = await request(
        '/v0/integrations/fake-monitoring/alerts',
        foxlangExecutionResponseSchema,
        {
          method: 'POST',
          body: JSON.stringify({...alert, run_id: runId}),
        },
      );
      latestFakeAlert = result;
      if (result.status === 'input_rejected') {
        throw new LocalWorkflowsError({
          message: 'Local workflows service rejected the fake alert input',
          code: 'local-service-input-rejected',
          status: 422,
          details: result,
        });
      }
      return {run_id: runId, result};
    },
  };
}

function assertSafeOpaqueId(value: string, label: string): void {
  if (
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\') ||
    hasControlChar(value)
  ) {
    throw new LocalWorkflowsError({
      message: `Local workflows ${label} contains unsupported path characters`,
      code: 'local-service-error',
      status: 400,
      details: {label},
    });
  }
}

function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

async function parseJson(response: Response, path: string): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LocalWorkflowsError({
      message: 'Local workflows service returned invalid JSON',
      code: 'local-service-malformed-response',
      status: 502,
      details: {path, status: response.status},
    });
  }
}

function throwIfLocalServiceError(response: Response, parsed: unknown): void {
  const localError = foxlangLocalServiceErrorResponseSchema.safeParse(parsed);
  if (localError.success) {
    throw new LocalWorkflowsError({
      message: localError.data.error.message ?? 'Local workflows service returned an error',
      code: 'local-service-error',
      status: response.status === 404 ? 404 : 502,
      details: localError.data,
    });
  }

  if (!response.ok) {
    const execution = foxlangExecutionResponseSchema.safeParse(parsed);
    if (execution.success && execution.data.status === 'input_rejected') {
      throw new LocalWorkflowsError({
        message: 'Local workflows service rejected the fake alert input',
        code: 'local-service-input-rejected',
        status: 422,
        details: execution.data,
      });
    }

    throw new LocalWorkflowsError({
      message: 'Local workflows service request failed',
      code: 'local-service-error',
      status: response.status >= 400 && response.status < 500 ? response.status : 502,
      details: parsed,
    });
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
