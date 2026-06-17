import {createOutboxTable} from '@shipfox/node-outbox';
import {pgTable} from './common.js';

// Table ships now so ENG-442 (stream-closed → compaction) only adds the event
// write, not a migration to an already-shipped schema. No publisher is
// registered on the module until that event exists.
export const logsOutbox = createOutboxTable(pgTable);
