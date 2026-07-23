import 'core-contracts';

import type {Row} from './database/types.js';
import {toDto as mapToDto} from './presenter/mapper.js';
import * as providers from './providers/index.js';

export * from './fixture/index.js';
export type {Fixture} from './test-support/types.js';
export {fixture} from './testing/factory.js';

const runtimePolicy = import('./core-utils/runtime.js');
type StoredRow = import('./database/stored-row.js').StoredRow;

void mapToDto;
void providers;
void runtimePolicy;

export type {Row, StoredRow};
