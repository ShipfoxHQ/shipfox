import {
  type AnthropicErrorBody,
  type AnthropicMessage,
  buildAnthropicError,
  buildAnthropicMessage,
} from './anthropic.js';
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

export type FakeOpenAiRequestAssertion = (
  | {
      kind: 'model';
      equals: string;
    }
  | {
      kind: 'tool_present';
      name: string;
    }
  | {
      kind: 'tool_absent';
      name: string;
    }
  | {
      kind: 'message_content_includes';
      value: string;
    }
  | {
      // An image in a message, such as the one an MCP tool returned. Text assertions can't see it.
      kind: 'image_content_present';
    }
) & {minRequestIndex?: number | undefined};

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

export type AnthropicScriptAdvanceResult =
  | {
      status: 200;
      body: AnthropicMessage;
    }
  | {
      status: number;
      body: AnthropicErrorBody;
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
      throw new Error(`Fake model provider script ${script.id} must define at least one response.`);
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
    const summary = summarizeModelProviderRequest(request.body);
    const assertionFailures = assertRequest(state.script.assertions ?? [], summary, requestIndex);

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
        body: buildOpenAiError(
          'script_exhausted',
          `Fake model provider script exhausted: ${scriptId}`,
        ),
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

  advanceAnthropic(
    scriptId: string,
    request: {body: unknown; method: string; path: string},
  ): AnthropicScriptAdvanceResult {
    const state = this.#scriptState(scriptId);
    const requestIndex = state.cursor;
    const summary = summarizeModelProviderRequest(request.body);

    if (summary.model !== null && summary.model !== state.script.model) {
      state.requests.push(
        recordedRequest({
          assertionFailures: [],
          request,
          requestIndex,
          servedResponse: 'message:non_consuming_model',
          summary,
        }),
      );

      return {
        status: 200,
        body: buildAnthropicMessage({
          model: summary.model,
          response: {kind: 'message', content: ''},
          responseIndex: requestIndex,
          scriptId,
        }),
      };
    }

    const assertionFailures = assertRequest(state.script.assertions ?? [], summary, requestIndex);

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
        body: buildAnthropicError(
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
        body: buildAnthropicError(
          'script_exhausted',
          `Fake model provider script exhausted: ${scriptId}`,
        ),
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
        body: buildAnthropicError('fake_provider_error', response.message),
      };
    }

    return {
      status: 200,
      body: buildAnthropicMessage({
        model: state.script.model,
        response,
        responseIndex: requestIndex,
        scriptId,
      }),
    };
  }

  #scriptState(scriptId: string): ScriptState {
    const state = this.#scripts.get(scriptId);
    if (!state) throw new Error(`Fake model provider script not found: ${scriptId}`);
    return state;
  }
}

interface ModelProviderRequestSummary {
  model: string | null;
  messageContent: string[];
  imageCount: number;
  tools: string[];
  messageRoles: string[];
}

function summarizeModelProviderRequest(body: unknown): ModelProviderRequestSummary {
  if (!body || typeof body !== 'object') {
    return {model: null, messageContent: [], imageCount: 0, tools: [], messageRoles: []};
  }

  const request = body as {
    messages?: unknown;
    model?: unknown;
    tools?: unknown;
  };

  return {
    model: typeof request.model === 'string' ? request.model : null,
    messageContent: messageContent(request.messages),
    imageCount: countImages(request.messages),
    tools: toolNames(request.tools),
    messageRoles: messageRoles(request.messages),
  };
}

function messageContent(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];

  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object') return [];
    return contentStrings((message as {content?: unknown}).content);
  });
}

function contentStrings(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (Array.isArray(content)) return content.flatMap(contentStrings);
  if (!content || typeof content !== 'object') return [];

  const {text, content: nestedContent} = content as {text?: unknown; content?: unknown};
  return [
    ...(typeof text === 'string' ? [text] : []),
    ...(nestedContent === undefined ? [] : contentStrings(nestedContent)),
  ];
}

// Images come as `image` blocks in Anthropic requests, and as `image_url` parts in OpenAI chat
// completions. A tool result nests them, so the walk goes through every level. The fake serves no
// Responses API, whose `input_image` parts would sit in `input`, not in `messages`.
const IMAGE_PART_TYPES = new Set(['image', 'image_url']);

function countImages(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countImages(item), 0);
  if (!value || typeof value !== 'object') return 0;

  const {type, content} = value as {type?: unknown; content?: unknown};
  if (typeof type === 'string' && IMAGE_PART_TYPES.has(type)) return 1;
  return countImages(content);
}

function toolNames(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];

  return tools.flatMap((tool) => {
    if (!tool || typeof tool !== 'object') return [];
    const topLevelName = (tool as {name?: unknown}).name;
    if (typeof topLevelName === 'string') return [topLevelName];

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
  summary: ModelProviderRequestSummary,
  requestIndex: number,
): string[] {
  return assertions.flatMap((assertion) => assertSingleRequest(assertion, summary, requestIndex));
}

function assertSingleRequest(
  assertion: FakeOpenAiRequestAssertion,
  summary: ModelProviderRequestSummary,
  requestIndex: number,
): string[] {
  if (assertion.minRequestIndex !== undefined && requestIndex < assertion.minRequestIndex) {
    return [];
  }

  switch (assertion.kind) {
    case 'model':
      return summary.model === assertion.equals
        ? []
        : [`Expected model ${assertion.equals} but received ${summary.model ?? '<missing>'}`];
    case 'tool_present':
      return summary.tools.includes(assertion.name)
        ? []
        : [
            `Expected tool ${assertion.name} to be present; received ${summary.tools.join(', ') || '<none>'}`,
          ];
    case 'tool_absent':
      return summary.tools.includes(assertion.name)
        ? [`Expected tool ${assertion.name} to be absent`]
        : [];
    case 'message_content_includes':
      return summary.messageContent.some((content) => content.includes(assertion.value))
        ? []
        : [`Expected message content to include ${assertion.value}`];
    case 'image_content_present':
      return summary.imageCount === 0 ? ['Expected a message to carry an image'] : [];
    default:
      // The assertion types are copied in `@shipfox/e2e-setup-agent`. A kind this fake doesn't
      // know would pass unchecked, so it fails the request instead.
      return [`Unknown assertion kind ${String((assertion as {kind?: unknown}).kind)}`];
  }
}

function recordedRequest(params: {
  assertionFailures: string[];
  request: {method: string; path: string};
  requestIndex: number;
  servedResponse: string | null;
  summary: ModelProviderRequestSummary;
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
