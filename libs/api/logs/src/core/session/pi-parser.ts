import type {SessionViewRow} from '@shipfox/api-logs-dto';
import {parseSessionEntry, sessionMessageEntrySchema} from './entry-schema.js';
import {toJson} from './object.js';
import {expandMessageEntry} from './pi/message-rows.js';
import {
  branchSummaryDetail,
  branchSummaryMeta,
  compactionDetail,
  compactionMeta,
  customEntryLabel,
  customEntryMeta,
  customEntryText,
  entryDetail,
  labelDetail,
  labelMeta,
  modelChangeDetail,
  sessionDetail,
} from './pi/metadata.js';
import {lifecycleRow, messageRow, rawRecordRow} from './rows.js';
import type {AgentSessionRecord} from './session-record.js';

export type {AgentSessionRecord} from './session-record.js';

export function parsePiSessionRecord(record: AgentSessionRecord): readonly SessionViewRow[] {
  const parsed = parseSessionEntry(record.data);
  if (!parsed.ok) {
    return [
      rawRecordRow(
        record,
        parsed.reason === 'invalid-json' ? 'Malformed session entry' : 'Unsupported entry',
      ),
    ];
  }

  const entry = parsed.entry;
  switch (entry.type) {
    case 'message': {
      const parsedEntry = sessionMessageEntrySchema.safeParse(entry);
      if (!parsedEntry.success) {
        return [
          {kind: 'raw', timestamp: record.ts, label: 'Unsupported message entry', raw: record.data},
        ];
      }
      return expandMessageEntry(record.ts, parsedEntry.data.message);
    }
    case 'session':
      return [lifecycleRow(record.ts, 'Session started', sessionDetail(entry), 'default', false)];
    case 'session_info':
      return [lifecycleRow(record.ts, 'Session info', entryDetail(entry), 'default', false)];
    case 'thinking_level_change':
      return [
        lifecycleRow(record.ts, 'Thinking level changed', entryDetail(entry), 'default', false),
      ];
    case 'model_change':
      return [lifecycleRow(record.ts, 'Model changed', modelChangeDetail(entry), 'default', false)];
    case 'compaction':
      return [
        lifecycleRow(
          record.ts,
          'Context compacted',
          compactionDetail(entry),
          'default',
          false,
          compactionMeta(entry),
        ),
      ];
    case 'branch_summary':
      return [
        messageRow(
          record.ts,
          'system',
          'branch summary',
          branchSummaryDetail(entry) ?? toJson(entry),
          false,
          branchSummaryMeta(entry),
        ),
      ];
    case 'custom':
      return [
        messageRow(
          record.ts,
          'custom',
          customEntryLabel('custom'),
          customEntryText(entry) ?? toJson(entry),
          false,
          customEntryMeta(entry),
        ),
      ];
    case 'custom_message':
      return [
        messageRow(
          record.ts,
          'custom',
          customEntryLabel('custom message'),
          customEntryText(entry) ?? toJson(entry),
          false,
          customEntryMeta(entry),
        ),
      ];
    case 'label':
      return [
        lifecycleRow(record.ts, 'Label', labelDetail(entry), 'default', false, labelMeta(entry)),
      ];
    default:
      return [rawRecordRow(record, `Unknown session entry: ${entry.type}`)];
  }
}
