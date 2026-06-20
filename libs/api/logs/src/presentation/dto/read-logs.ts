import type {ReadLogsResponseDto} from '@shipfox/api-logs-dto';
import type {LogReadResult} from '#core/read-logs.js';

/** Maps the domain read result (camelCase) to the public snake_case read response. */
export function toReadLogsDto(result: LogReadResult): ReadLogsResponseDto {
  if (result.mode === 'presigned') {
    return {
      mode: 'presigned',
      url: result.url,
      expires_at: result.expiresAt.toISOString(),
      total_bytes: result.totalBytes,
      truncated: result.truncated,
    };
  }

  return {
    mode: 'inline',
    ndjson: result.ndjson,
    next_cursor: result.nextCursor,
    has_more: result.hasMore,
    state: result.state,
    truncated: result.truncated,
  };
}
