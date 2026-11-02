import type {ImageContent, TextContent} from '@earendil-works/pi-ai';
import type {AgentToolResult} from '@earendil-works/pi-coding-agent';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

export function piToolContent(
  content: CallToolResult['content'],
): AgentToolResult<unknown>['content'] {
  return content.map((block) => {
    if (block.type === 'text') return block as TextContent;
    if (block.type === 'image') return block as ImageContent;
    return {
      type: 'text' as const,
      text: JSON.stringify(block) ?? String(block),
    };
  });
}
