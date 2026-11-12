import {cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileEmailTemplate, compileEmailTemplates, EmailCompileError} from '#compile.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'emails');
const fixture = (name: string) => join(fixturesDir, `${name}.mjml`);

describe('compileEmailTemplate', () => {
  test('inlines the shared chrome and keeps the Handlebars expressions', async () => {
    const html = await compileEmailTemplate({filePath: fixture('order-shipped')});

    expect(html).toContain('alt="Shipfox"');
    expect(html).toContain('{{logoUrl}}');
    expect(html).toContain('IBM Plex Sans');
    expect(html).toContain('Hello {{customerName}}');
    expect(html).toContain('{{#each items}}');
  });

  test('keeps a block helper wrapped in mj-raw', async () => {
    const html = await compileEmailTemplate({filePath: fixture('order-shipped')});

    expect(html).toContain('{{#if urgent}}');
    expect(html).toContain('{{else}}');
    expect(html).toContain('{{/if}}');
  });

  test('throws EmailCompileError naming an unknown shared partial', async () => {
    const error = await compileEmailTemplate({filePath: fixture('unknown-partial')}).catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(EmailCompileError);
    expect((error as EmailCompileError).templateName).toBe('unknown-partial');
    expect((error as Error).message).toContain('partials/nope.mjml');
  });

  test('throws EmailCompileError for a bare block helper between MJML components', async () => {
    const error = await compileEmailTemplate({filePath: fixture('bare-helper')}).catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(EmailCompileError);
    expect((error as Error).message).toContain('<mj-raw>');
  });
});

describe('compileEmailTemplates', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'shipfox-email-compiler-'));
  });

  afterEach(async () => {
    await rm(workDir, {recursive: true, force: true});
  });

  test('writes one Handlebars template per top-level template and skips subdirectories', async () => {
    const sourceDir = join(workDir, 'emails');
    const outDir = join(workDir, 'dist', 'emails');
    await mkdir(join(sourceDir, 'partials'), {recursive: true});
    await cp(fixture('order-shipped'), join(sourceDir, 'order-shipped.mjml'));
    await cp(fixture('bare-helper'), join(sourceDir, 'partials', 'bare-helper.mjml'));

    const names = await compileEmailTemplates({sourceDir, outDir});

    expect(names).toEqual(['order-shipped']);
    expect(await readdir(outDir)).toEqual(['order-shipped.hbs']);
    expect(await readFile(join(outDir, 'order-shipped.hbs'), 'utf8')).toContain(
      'Hello {{customerName}}',
    );
  });

  test('removes outputs whose source template no longer exists', async () => {
    const sourceDir = join(workDir, 'emails');
    const outDir = join(workDir, 'dist', 'emails');
    await mkdir(sourceDir, {recursive: true});
    await mkdir(outDir, {recursive: true});
    await cp(fixture('order-shipped'), join(sourceDir, 'order-shipped.mjml'));
    await writeFile(join(outDir, 'deleted-template.hbs'), 'stale');
    await writeFile(join(outDir, 'notes.txt'), 'kept');

    await compileEmailTemplates({sourceDir, outDir});

    expect((await readdir(outDir)).sort()).toEqual(['notes.txt', 'order-shipped.hbs']);
  });
});
