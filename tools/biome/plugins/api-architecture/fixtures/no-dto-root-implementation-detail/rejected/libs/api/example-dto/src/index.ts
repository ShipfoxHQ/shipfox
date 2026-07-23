import 'core';

import type {Row} from './db/types.js';
import {toDto as mapToDto} from './presentation/mapper.js';
import * as providers from './provider/index.js';

export * from './fixtures/index.js';
export {fixture} from './test/factory.js';
export type {Fixture} from './tests/types.js';

const runtimePolicy = import('./core/runtime.js');
type StoredRow = import('./db/stored-row.js').StoredRow;

void mapToDto;
void providers;
void runtimePolicy;

export type {Row, StoredRow};
