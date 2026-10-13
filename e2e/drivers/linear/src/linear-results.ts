import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

export type LinearToolResult = CallToolResult;

export function jsonResult(value: unknown): LinearToolResult {
  return {content: [{type: 'text', text: JSON.stringify(value)}]};
}

function errorResult(message: string): LinearToolResult {
  return {
    isError: true,
    content: [
      {type: 'text', text: JSON.stringify({error: 'invalid_request', message, status: 400})},
    ],
  };
}

export function notFound(entity: string): LinearToolResult {
  return errorResult(`Could not find referenced ${entity}.`);
}

/** An argument the fake cannot apply to its state fails the call, so no read answers as if it had. */
export function unsupportedArguments(tool: string, names: readonly string[]): LinearToolResult {
  return errorResult(`The Linear fake does not apply ${names.join(', ')} in ${tool}.`);
}

export function missingArgument(tool: string, name: string): LinearToolResult {
  return errorResult(`${tool} needs ${name}.`);
}
