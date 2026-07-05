import type {ReadLogsResponseDto} from '@shipfox/api-logs-dto';
import type {LogReadResult} from '#core/read-logs.js';

export function toReadLogsDto(result: LogReadResult): ReadLogsResponseDto {
  if (result.mode === 'presigned') {
    return {
      mode: 'presigned',
      url: result.url,
      state: result.state,
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
