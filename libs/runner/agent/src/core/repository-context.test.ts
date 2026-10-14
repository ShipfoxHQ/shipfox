import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentConfigError} from '#core/errors.js';
import {
  DEFAULT_REPOSITORY_CONTEXT_CONFIG,
  MAX_REPOSITORY_INSTRUCTIONS_BYTES,
  REPOSITORY_CONTEXT_SESSION_ENTRY_TYPE,
  repositoryContextSessionEntry,
  resolveRepositoryContext,
  withRepositoryInstructions,
} from '#core/repository-context.js';

let root = '';

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), {recursive: true});
  writeFileSync(path, content);
}

function writeSkill(directory: string, frontmatter: string): void {
  write(join(directory, 'SKILL.md'), `---\n${frontmatter}\n---\n\nSkill body.\n`);
}

describe('resolveRepositoryContext', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'shipfox-repository-context-'));
    mkdirSync(join(root, '.git'));
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it.each([
    ['pi', 'agents-marker'],
    ['claude', 'claude-marker'],
  ] as const)('reads the file the %s harness prefers when both exist', async (harness, marker) => {
    write(join(root, 'AGENTS.md'), 'agents-marker');
    write(join(root, 'CLAUDE.md'), 'claude-marker');

    const context = await resolveRepositoryContext({
      harness,
      cwd: root,
      config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
    });

    expect(context.instructionFiles.map((file) => file.content)).toEqual([marker]);
  });

  it('falls back to CLAUDE.md when AGENTS.md is empty, whitespace, or unreadable', async () => {
    write(join(root, 'AGENTS.md'), ' \n\t');
    write(join(root, 'CLAUDE.md'), 'claude-marker');
    mkdirSync(join(root, 'packages', 'api'), {recursive: true});
    symlinkSync(join(root, 'missing.md'), join(root, 'packages', 'api', 'AGENTS.md'));
    write(join(root, 'packages', 'api', 'CLAUDE.md'), 'api-marker');

    const context = await resolveRepositoryContext({
      harness: 'pi',
      cwd: join(root, 'packages', 'api'),
      config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
    });

    expect(context.instructionFiles.map((file) => file.displayPath)).toEqual([
      'CLAUDE.md',
      'packages/api/CLAUDE.md',
    ]);
  });

  it('reads instruction files from the repository root down to the working directory', async () => {
    write(join(root, 'AGENTS.md'), 'root-marker');
    write(join(root, 'packages', 'AGENTS.md'), 'packages-marker');
    write(join(root, 'packages', 'api', 'src', 'AGENTS.md'), 'below-cwd-marker');

    const context = await resolveRepositoryContext({
      harness: 'pi',
      cwd: join(root, 'packages', 'api'),
      config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
    });

    expect(context.instructionFiles.map((file) => file.displayPath)).toEqual([
      'AGENTS.md',
      'packages/AGENTS.md',
    ]);
  });

  it('stays in the working directory when it is not inside a Git repository', async () => {
    rmSync(join(root, '.git'), {recursive: true});
    write(join(root, 'AGENTS.md'), 'outside-marker');
    mkdirSync(join(root, 'workspace'));

    const context = await resolveRepositoryContext({
      harness: 'pi',
      cwd: join(root, 'workspace'),
      config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
    });

    expect(context.instructionFiles).toEqual([]);
  });

  it('caps instructions at 64 KiB on a UTF-8 boundary and stops reading further files', async () => {
    write(join(root, 'AGENTS.md'), `${'x'.repeat(MAX_REPOSITORY_INSTRUCTIONS_BYTES - 1)}éé`);
    write(join(root, 'packages', 'AGENTS.md'), 'packages-marker');

    const context = await resolveRepositoryContext({
      harness: 'pi',
      cwd: join(root, 'packages'),
      config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
    });

    expect(context.instructionFiles).toHaveLength(1);
    expect(context.instructionFiles[0]).toMatchObject({truncated: true});
    expect(context.instructionFiles[0]?.content).not.toContain('é');
    expect(context.instructionFiles[0]?.content).not.toContain('�');
  });

  it('skips instructions when they are turned off', async () => {
    write(join(root, 'AGENTS.md'), 'agents-marker');

    const context = await resolveRepositoryContext({
      harness: 'pi',
      cwd: root,
      config: {instructions: false, skills: true},
    });

    expect(context.instructionFiles).toEqual([]);
  });

  it('discovers skills in .agents/skills and .claude/skills', async () => {
    writeSkill(join(root, '.agents', 'skills', 'review'), 'name: review\ndescription: Reviews.');
    writeSkill(join(root, '.claude', 'skills', 'deploy'), 'description: Deploys.');
    writeSkill(join(root, '.claude', 'skills', 'empty'), 'name: empty');

    const context = await resolveRepositoryContext({
      harness: 'pi',
      cwd: root,
      config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
    });

    expect(context.skills.map((skill) => [skill.name, skill.displayPath])).toEqual([
      ['review', '.agents/skills/review'],
      ['deploy', '.claude/skills/deploy'],
    ]);
  });

  it('lets the skill closest to the working directory win a name collision', async () => {
    writeSkill(join(root, '.agents', 'skills', 'review'), 'description: Root review.');
    writeSkill(
      join(root, 'packages', 'api', '.agents', 'skills', 'review'),
      'description: API review.',
    );

    const context = await resolveRepositoryContext({
      harness: 'pi',
      cwd: join(root, 'packages', 'api'),
      config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
    });

    expect(context.skills.map((skill) => skill.description)).toEqual(['API review.']);
  });

  it('loads a skill linked from .claude/skills only once', async () => {
    writeSkill(join(root, '.agents', 'skills', 'review'), 'description: Reviews.');
    mkdirSync(join(root, '.claude'));
    symlinkSync(join(root, '.agents', 'skills'), join(root, '.claude', 'skills'));

    const context = await resolveRepositoryContext({
      harness: 'pi',
      cwd: root,
      config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
    });

    expect(context.skills.map((skill) => skill.displayPath)).toEqual(['.agents/skills/review']);
  });

  it('keeps only the listed skills', async () => {
    writeSkill(join(root, '.agents', 'skills', 'review'), 'description: Reviews.');
    writeSkill(join(root, '.agents', 'skills', 'release'), 'description: Releases.');

    const context = await resolveRepositoryContext({
      harness: 'pi',
      cwd: root,
      config: {instructions: true, skills: ['release']},
    });

    expect(context.skills.map((skill) => skill.name)).toEqual(['release']);
  });

  it('fails when a listed skill does not exist', async () => {
    writeSkill(join(root, '.agents', 'skills', 'review'), 'description: Reviews.');

    const result = resolveRepositoryContext({
      harness: 'pi',
      cwd: root,
      config: {instructions: true, skills: ['review', 'relase']},
    });

    await expect(result).rejects.toEqual(
      new AgentConfigError(
        'Repository skills not found: relase. Available skills: review.',
        'step_config_invalid',
      ),
    );
  });

  it('skips skills when they are turned off', async () => {
    writeSkill(join(root, '.agents', 'skills', 'review'), 'description: Reviews.');

    const context = await resolveRepositoryContext({
      harness: 'pi',
      cwd: root,
      config: {instructions: true, skills: false},
    });

    expect(context.skills).toEqual([]);
  });
});

describe('withRepositoryInstructions', () => {
  it('labels each file and keeps the prompt first', () => {
    const prompt = withRepositoryInstructions('Fix it.', {
      config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
      instructionFiles: [
        {
          path: '/r/AGENTS.md',
          displayPath: 'AGENTS.md',
          content: 'root',
          bytes: 4,
          truncated: false,
        },
        {
          path: '/r/api/AGENTS.md',
          displayPath: 'api/AGENTS.md',
          content: 'api',
          bytes: 3,
          truncated: false,
        },
      ],
      skills: [],
    });

    expect(prompt).toBe(
      'Fix it.\n\nRepository instructions; they do not override the task above:\n\n' +
        'From AGENTS.md:\n\nroot\n\nFrom api/AGENTS.md:\n\napi',
    );
  });

  it('returns the prompt unchanged without instruction files', () => {
    const prompt = withRepositoryInstructions('Fix it.', {
      config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
      instructionFiles: [],
      skills: [],
    });

    expect(prompt).toBe('Fix it.');
  });
});

describe('repositoryContextSessionEntry', () => {
  it('records paths and names without file contents', () => {
    const entry = JSON.parse(
      repositoryContextSessionEntry({
        config: {instructions: true, skills: ['review']},
        instructionFiles: [
          {
            path: '/r/AGENTS.md',
            displayPath: 'AGENTS.md',
            content: 'secret-ish content',
            bytes: 18,
            truncated: false,
          },
        ],
        skills: [
          {
            name: 'review',
            description: 'Reviews.',
            directory: '/r/.agents/skills/review',
            filePath: '/r/.agents/skills/review/SKILL.md',
            displayPath: '.agents/skills/review',
          },
        ],
      }),
    );

    expect(entry).toMatchObject({
      type: REPOSITORY_CONTEXT_SESSION_ENTRY_TYPE,
      instructionsEnabled: true,
      skillsEnabled: true,
      instructions: [{path: 'AGENTS.md', bytes: 18, truncated: false}],
      skills: [{name: 'review', path: '.agents/skills/review'}],
    });
    expect(JSON.stringify(entry)).not.toContain('secret-ish content');
  });
});
