import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export type {ListAnnotationsForRunAttemptParams} from './annotations.js';
export {DEFAULT_ANNOTATIONS_READ_LIMIT, listAnnotationsForRunAttempt} from './annotations.js';
