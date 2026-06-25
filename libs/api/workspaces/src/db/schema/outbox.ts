import {createOutboxTable} from '@shipfox/node-outbox';
import {pgTable} from './common.js';

export const workspacesOutbox = createOutboxTable(pgTable);
