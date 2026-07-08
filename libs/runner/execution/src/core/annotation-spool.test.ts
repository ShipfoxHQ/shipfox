import {access, chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {logger} from '@shipfox/node-opentelemetry';
import {
  ANNOTATION_BODY_MAX_BYTES,
  ANNOTATION_MAX_SPOOL_BYTES,
  type AnnotationSpool,
  collectAnnotationOperations,
  createAnnotationSpool,
  disposeAnnotationSpool,
} from '#core/annotation-spool.js';

let tempDirs: string[] = [];

describe('annotation spool', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
    tempDirs = [];
  });

  it('creates summary and operation spool env paths and disposes them', async () => {
    const spool = await createAnnotationSpool();

    expect(spool.env).toEqual({
      SHIPFOX_STEP_SUMMARY: spool.summaryPath,
      SHIPFOX_ANNOTATIONS_DIR: spool.annotationsDir,
    });
    expect((await stat(spool.summaryPath)).isFile()).toBe(true);
    expect((await stat(spool.annotationsDir)).isDirectory()).toBe(true);

    await disposeAnnotationSpool(spool);

    await expect(access(spool.summaryPath)).rejects.toThrow();
    await expect(access(spool.annotationsDir)).rejects.toThrow();
  });

  it('collects summary and sorted operation files into resolved wire operations', async () => {
    const spool = await makeSpool();
    await writeFile(spool.summaryPath, 'summary');
    await writeFile(
      join(spool.annotationsDir, '002-b.json'),
      JSON.stringify({context: 'deploy', op: 'append', body: ' done'}),
    );
    await writeFile(
      join(spool.annotationsDir, '001-a.json'),
      JSON.stringify({context: 'deploy', style: 'info', body: 'started'}),
    );

    const operations = await collectAnnotationOperations(spool);

    expect(operations).toEqual([
      {context: 'default', style: 'default', op: 'replace', body: 'summary'},
      {context: 'deploy', style: 'info', op: 'replace', body: 'started done'},
    ]);
  });

  it('skips malformed JSON, schema-invalid files, and non-files without throwing', async () => {
    const warn = vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
    const spool = await makeSpool();
    await writeFile(join(spool.annotationsDir, '001-invalid-json.json'), '{');
    await writeFile(join(spool.annotationsDir, '002-invalid-schema.json'), '{"context":"deploy"}');
    await mkdir(join(spool.annotationsDir, '003-dir.json'));
    await writeFile(
      join(spool.annotationsDir, '004-valid.json'),
      JSON.stringify({context: 'deploy', op: 'append', body: 'body'}),
    );

    const operations = await collectAnnotationOperations(spool);

    expect(operations).toEqual([{context: 'deploy', style: 'default', op: 'append', body: 'body'}]);
    expect(warn).toHaveBeenCalled();
  });

  it('returns an empty list for missing spool paths', async () => {
    const operations = await collectAnnotationOperations({
      summaryPath: join(tmpdir(), 'shipfox-missing-summary'),
      annotationsDir: join(tmpdir(), 'shipfox-missing-annotations'),
      env: {
        SHIPFOX_STEP_SUMMARY: 'unused',
        SHIPFOX_ANNOTATIONS_DIR: 'unused',
      },
    });

    expect(operations).toEqual([]);
  });

  it('bounds an over-cap summary file and keeps the step fail-open', async () => {
    const warn = vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
    const spool = await makeSpool();
    await writeFile(spool.summaryPath, Buffer.alloc(ANNOTATION_BODY_MAX_BYTES + 1, 'x'));

    const operations = await collectAnnotationOperations(spool);

    expect(operations).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({limit: ANNOTATION_BODY_MAX_BYTES}),
      expect.stringContaining('exceeds the local read limit'),
    );
  });

  it('skips symlinked annotation files', async () => {
    const spool = await makeSpool();
    const summaryTarget = `${spool.summaryPath}-target`;
    const operationTarget = `${spool.summaryPath}-operation-target`;
    await rm(spool.summaryPath);
    await writeFile(summaryTarget, 'summary-secret');
    await writeFile(
      operationTarget,
      JSON.stringify({context: 'deploy', op: 'append', body: 'operation-secret'}),
    );
    await symlink(summaryTarget, spool.summaryPath);
    await symlink(operationTarget, join(spool.annotationsDir, '001-symlink.json'));

    const operations = await collectAnnotationOperations(spool);

    expect(operations).toEqual([]);
  });

  it('keeps valid operations when a single operation file cannot be read', async () => {
    const warn = vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
    const spool = await makeSpool();
    const unreadablePath = join(spool.annotationsDir, '002-unreadable.json');
    await writeFile(
      join(spool.annotationsDir, '001-valid.json'),
      JSON.stringify({context: 'deploy', op: 'append', body: 'body'}),
    );
    await writeFile(unreadablePath, JSON.stringify({context: 'deploy', op: 'append', body: 'bad'}));
    await chmod(unreadablePath, 0o000);

    const operations = await collectAnnotationOperations(spool);

    expect(operations).toEqual([{context: 'deploy', style: 'default', op: 'append', body: 'body'}]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({path: unreadablePath}),
      'Skipping unreadable annotation operation file',
    );
  });

  it('counts skipped oversized operation files against the spool byte limit', async () => {
    const warn = vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
    const spool = await makeSpool();
    await writeFile(
      join(spool.annotationsDir, '001-oversized.json'),
      Buffer.alloc(ANNOTATION_MAX_SPOOL_BYTES + 1, 'x'),
    );
    await writeFile(
      join(spool.annotationsDir, '002-valid.json'),
      JSON.stringify({context: 'deploy', op: 'append', body: 'body'}),
    );

    const operations = await collectAnnotationOperations(spool);

    expect(operations).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({limit: ANNOTATION_MAX_SPOOL_BYTES}),
      'Annotation operation spool byte limit exceeded; skipping remaining files',
    );
  });
});

async function makeSpool(): Promise<AnnotationSpool> {
  const root = await mkdtemp(join(tmpdir(), 'shipfox-annotations-test-'));
  tempDirs.push(root);
  const summaryPath = join(root, 'summary');
  const annotationsDir = join(root, 'annotations');
  await writeFile(summaryPath, '');
  await mkdir(annotationsDir);
  return {
    summaryPath,
    annotationsDir,
    env: {
      SHIPFOX_STEP_SUMMARY: summaryPath,
      SHIPFOX_ANNOTATIONS_DIR: annotationsDir,
    },
  };
}
