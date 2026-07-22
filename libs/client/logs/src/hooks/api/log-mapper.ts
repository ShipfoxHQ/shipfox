import {
  type LogRecord as LogRecordDto,
  parseLogRecordLine,
  type ReadLogsResponseDto,
} from '@shipfox/api-logs-dto';
import type {InlineLogRead, LogRecord, PresignedLogRead, SessionViewRow} from '#core/log-model.js';

const NDJSON_LINE_BREAK = /\r?\n/;

export function toLogRead(response: ReadLogsResponseDto): InlineLogRead | PresignedLogRead {
  if (response.mode === 'presigned') {
    return {
      mode: 'presigned',
      url: response.url,
      expiresAt: response.expires_at,
      totalBytes: response.total_bytes,
      truncated: response.truncated,
    };
  }

  return {
    mode: 'inline',
    ndjson: response.ndjson,
    nextCursor: response.next_cursor,
    hasMore: response.has_more,
    state: response.state,
    truncated: response.truncated,
  };
}

/**
 * The compacted object is fetched from a presigned external URL, so every line is
 * validated at this boundary before it can enter the package-owned query snapshot.
 */
export function parseLogNdjson(ndjson: string): LogRecord[] {
  return ndjson
    .split(NDJSON_LINE_BREAK)
    .filter((line) => line.length > 0)
    .map((line) => toLogRecord(parseLogRecordLine(line)));
}

export function toLogRecord(record: LogRecordDto): LogRecord {
  const base: {v: 1; ts: number} = {v: record.v, ts: record.ts};
  switch (record.type) {
    case 'output':
      return {...base, type: record.type, stream: record.stream, data: record.data};
    case 'group_start':
      return {
        ...base,
        type: record.type,
        groupId: record.group_id,
        parentGroupId: record.parent_group_id,
        name: record.name,
      };
    case 'group_end':
      return {...base, type: record.type, groupId: record.group_id};
    case 'end':
      return {...base, type: record.type, totalBytes: record.total_bytes};
    case 'gap':
      return {...base, type: record.type, droppedBytes: record.dropped_bytes};
    case 'agent_session':
      return {...base, type: record.type, row: toSessionViewRow(record.row)};
    case 'capped':
    case 'runner_lost':
      return {...base, type: record.type};
  }
}

function toSessionViewRow(
  row: Extract<LogRecordDto, {type: 'agent_session'}>['row'],
): SessionViewRow {
  return row.kind === 'message' || row.kind === 'lifecycle'
    ? {...row, meta: row.meta.map((meta) => ({...meta}))}
    : {...row};
}
