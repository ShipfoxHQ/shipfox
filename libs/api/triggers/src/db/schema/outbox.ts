import {createOutboxTable} from '@shipfox/node-outbox';
import {pgTable} from './common.js';

export const triggersOutbox = createOutboxTable(pgTable);
