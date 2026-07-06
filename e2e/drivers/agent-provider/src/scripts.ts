import {buildChatCompletion, buildOpenAiError, type OpenAiChatCompletion} from './openai.js';

export interface FakeOpenAiScript {
  id: string;
  model: string;
  responses: FakeOpenAiResponse[];
  assertions?: FakeOpenAiRequestAssertion[] | undefined;
}

export type FakeOpenAiResponse =
  | {
      kind: 'tool_call';
      toolName: string;
      arguments: Record<string, unknown>;
      content?: string | undefined;
    }
  | {
      kind: 'message';
      content: string;
    }
  | {
      kind: 'error';
      status: number;
      message: string;
    };

export type FakeOpenAiRequestAssertion =
  | {
      kind: 'model';
      equals: string;
    }
  | {
      kind: 'tool_present';
      name: string;
    };

export interface FakeOpenAiRecordedRequest {
  index: number;
  method: string;
  path: string;
  model: string | null;
  tools: string[];
  message_roles: string[];
  served_response: string | null;
  assertion_failures: string[];
  created_at: string;
}

export interface ScriptRegistrationResult {
  scriptId: string;
  model: string;
}

export type ScriptAdvanceResult =
  | {
      status: 200;
      body: OpenAiChatCompletion;
    }
  | {
      status: number;
      body: ReturnType<typeof buildOpenAiError>;
    };

interface ScriptState {
  cursor: number;
  requests: FakeOpenAiRecordedRequest[];
  script: FakeOpenAiScript;
}

export class FakeOpenAiScriptRegistry {
  readonly #scripts = new Map<string, ScriptState>();

  register(script: FakeOpenAiScript): ScriptRegistrationResult {
    if (script.responses.length === 0) {
      throw new Error(`Fake provider script ${script.id} must define at least one response.`);
    }

    this.#scripts.set(script.id, {
      cursor: 0,
      requests: [],
      script,
    });

    return {
      scriptId: script.id,
      model: script.model,
    };
  }

  reset(scriptId: string): void {
    const state = this.#scriptState(scriptId);
    state.cursor = 0;
    state.requests = [];
  }

  requests(scriptId: string): FakeOpenAiRecordedRequest[] {
    return [...this.#scriptState(scriptId).requests];
  }

  script(scriptId: string): FakeOpenAiScript {
    return this.#scriptState(scriptId).script;
  }

  advance(
    scriptId: string,
    request: {body: unknown; method: string; path: string},
  ): ScriptAdvanceResult {
    const state = this.#scriptState(scriptId);
    const requestIndex = state.cursor;
    const summary = summarizeOpenAiRequest(request.body);
    const assertionFailures = assertRequest(state.script.assertions ?? [], summary);

    if (assertionFailures.length > 0) {
      state.requests.push(
        recordedRequest({
          assertionFailures,
          request,
          requestIndex,
          servedResponse: null,
          summary,
        }),
      );

      return {
        status: 422,
        body: buildOpenAiError(
          'script_assertion_failed',
          assertionFailures[0] ?? 'Script assertion failed',
        ),
      };
    }

    const response = state.script.responses[requestIndex];
    if (!response) {
      state.requests.push(
        recordedRequest({
          assertionFailures,
          request,
          requestIndex,
          servedResponse: 'error:script_exhausted',
          summary,
        }),
      );

      return {
        status: 409,
        body: buildOpenAiError('script_exhausted', `Fake provider script exhausted: ${scriptId}`),
      };
    }

    state.cursor += 1;
    const servedResponse = describeResponse(response);
    state.requests.push(
      recordedRequest({
        assertionFailures,
        request,
        requestIndex,
        servedResponse,
        summary,
      }),
    );

    if (response.kind === 'error') {
      return {
        status: response.status,
        body: buildOpenAiError('fake_provider_error', response.message),
      };
    }

    return {
      status: 200,
      body: buildChatCompletion({
        model: state.script.model,
        response,
        responseIndex: requestIndex,
        scriptId,
      }),
    };
  }

  #scriptState(scriptId: string): ScriptState {
    const state = this.#scripts.get(scriptId);
    if (!state) throw new Error(`Fake provider script not found: ${scriptId}`);
    return state;
  }
}

interface OpenAiRequestSummary {
  model: string | null;
  tools: string[];
  messageRoles: string[];
}

function summarizeOpenAiRequest(body: unknown): OpenAiRequestSummary {
  if (!body || typeof body !== 'object') {
    return {model: null, tools: [], messageRoles: []};
  }

  const request = body as {
    messages?: unknown;
    model?: unknown;
    tools?: unknown;
  };

  return {
    model: typeof request.model === 'string' ? request.model : null,
    tools: toolNames(request.tools),
    messageRoles: messageRoles(request.messages),
  };
}

function toolNames(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];

  return tools.flatMap((tool) => {
    if (!tool || typeof tool !== 'object') return [];
    const functionTool = (tool as {function?: unknown}).function;
    if (!functionTool || typeof functionTool !== 'object') return [];
    const name = (functionTool as {name?: unknown}).name;
    return typeof name === 'string' ? [name] : [];
  });
}

function messageRoles(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];

  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object') return [];
    const role = (message as {role?: unknown}).role;
    return typeof role === 'string' ? [role] : [];
  });
}

function assertRequest(
  assertions: FakeOpenAiRequestAssertion[],
  summary: OpenAiRequestSummary,
): string[] {
  return assertions.flatMap((assertion) => {
    if (assertion.kind === 'model' && summary.model !== assertion.equals) {
      return [`Expected model ${assertion.equals} but received ${summary.model ?? '<missing>'}`];
    }

    if (assertion.kind === 'tool_present' && !summary.tools.includes(assertion.name)) {
      return [`Expected tool ${assertion.name} to be present`];
    }

    return [];
  });
}

function recordedRequest(params: {
  assertionFailures: string[];
  request: {method: string; path: string};
  requestIndex: number;
  servedResponse: string | null;
  summary: OpenAiRequestSummary;
}): FakeOpenAiRecordedRequest {
  return {
    index: params.requestIndex,
    method: params.request.method,
    path: params.request.path,
    model: params.summary.model,
    tools: params.summary.tools,
    message_roles: params.summary.messageRoles,
    served_response: params.servedResponse,
    assertion_failures: params.assertionFailures,
    created_at: new Date().toISOString(),
  };
}

function describeResponse(response: FakeOpenAiResponse): string {
  if (response.kind === 'tool_call') return `tool_call:${response.toolName}`;
  if (response.kind === 'message') return 'message';
  return `error:${response.status}`;
}
