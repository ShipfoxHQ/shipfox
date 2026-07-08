import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir, open, readdir, rm, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {LeasedWriteAnnotationOperationDto} from '@shipfox/annotations-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {
  type AnnotationOperationFile,
  annotationOperationFileSchema,
  resolveAnnotationOperations,
} from '#core/annotations.js';

export const ANNOTATION_BODY_MAX_BYTES = 1024 * 1024;
export const ANNOTATION_MAX_OP_FILES = 256;
export const ANNOTATION_MAX_SPOOL_BYTES = 5 * 1024 * 1024;

export interface AnnotationSpool {
  summaryPath: string;
  annotationsDir: string;
  env: {
    SHIPFOX_STEP_SUMMARY: string;
    SHIPFOX_ANNOTATIONS_DIR: string;
  };
}

export async function createAnnotationSpool(): Promise<AnnotationSpool> {
  const summaryPath = join(tmpdir(), `shipfox-step-summary-${randomUUID()}`);
  const annotationsDir = join(tmpdir(), `shipfox-annotations-${randomUUID()}`);

  await writeFile(summaryPath, '', {mode: 0o600});
  await mkdir(annotationsDir, {mode: 0o700});

  return {
    summaryPath,
    annotationsDir,
    env: {
      SHIPFOX_STEP_SUMMARY: summaryPath,
      SHIPFOX_ANNOTATIONS_DIR: annotationsDir,
    },
  };
}

export async function collectAnnotationOperations(
  spool: AnnotationSpool,
): Promise<LeasedWriteAnnotationOperationDto[]> {
  try {
    const summary = await readOptionalBoundedFile(spool.summaryPath, 'summary');
    const operations = await readOperationFiles(spool);
    return resolveAnnotationOperations({summary, operations});
  } catch (error) {
    logger().warn({err: error}, 'Failed to collect step annotations; skipping annotations');
    return [];
  }
}

export async function disposeAnnotationSpool(spool: AnnotationSpool): Promise<void> {
  await unlink(spool.summaryPath).catch(() => undefined);
  await rm(spool.annotationsDir, {recursive: true, force: true}).catch(() => undefined);
}

async function readOperationFiles(spool: AnnotationSpool): Promise<AnnotationOperationFile[]> {
  let entries: Array<{name: string; isFile(): boolean}>;
  try {
    entries = await readdir(spool.annotationsDir, {withFileTypes: true});
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }

  const files = entries
    .filter((entry) => {
      if (entry.isFile()) return true;
      logger().warn(
        {path: join(spool.annotationsDir, entry.name)},
        'Skipping non-file annotation operation spool entry',
      );
      return false;
    })
    .map((entry) => entry.name)
    .sort();

  if (files.length > ANNOTATION_MAX_OP_FILES) {
    logger().warn(
      {count: files.length, limit: ANNOTATION_MAX_OP_FILES},
      'Annotation operation spool file limit exceeded; skipping remaining files',
    );
  }

  const operations: AnnotationOperationFile[] = [];
  let totalBytes = 0;
  for (const name of files.slice(0, ANNOTATION_MAX_OP_FILES)) {
    const path = join(spool.annotationsDir, name);
    const raw = await readOptionalBoundedFile(path, 'operation');
    if (raw === undefined) continue;

    totalBytes += Buffer.byteLength(raw, 'utf8');
    if (totalBytes > ANNOTATION_MAX_SPOOL_BYTES) {
      logger().warn(
        {limit: ANNOTATION_MAX_SPOOL_BYTES},
        'Annotation operation spool byte limit exceeded; skipping remaining files',
      );
      break;
    }

    const parsedJson = parseJson(raw, path);
    if (parsedJson === undefined) continue;

    const parsedOperation = annotationOperationFileSchema.safeParse(parsedJson);
    if (!parsedOperation.success) {
      logger().warn({path}, 'Skipping malformed annotation operation file');
      continue;
    }

    operations.push(parsedOperation.data);
  }

  return operations;
}

async function readOptionalBoundedFile(
  path: string,
  kind: 'summary' | 'operation',
): Promise<string | undefined> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK).catch((error) => {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  });
  if (!handle) return undefined;

  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      logger().warn({path}, `Skipping non-regular annotation ${kind} file`);
      return undefined;
    }

    const buffer = Buffer.alloc(ANNOTATION_BODY_MAX_BYTES + 1);
    const {bytesRead} = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead === 0) return undefined;
    if (bytesRead > ANNOTATION_BODY_MAX_BYTES) {
      logger().warn(
        {path, limit: ANNOTATION_BODY_MAX_BYTES},
        `Annotation ${kind} file exceeds the local read limit; skipping file`,
      );
      return undefined;
    }
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function parseJson(raw: string, path: string): unknown | undefined {
  try {
    return JSON.parse(raw);
  } catch (error) {
    logger().warn({err: error, path}, 'Skipping annotation operation file with invalid JSON');
    return undefined;
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}
