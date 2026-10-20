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

  it('discovers skills in the skill directories of mainstream coding agents', async () => {
    writeSkill(join(root, '.agents', 'skills', 'review'), 'name: review\ndescription: Reviews.');
    writeSkill(join(root, '.claude', 'skills', 'deploy'), 'description: Deploys.');
    writeSkill(join(root, '.claude', 'skills', 'empty'), 'name: empty');
    writeSkill(join(root, '.pi', 'skills', 'plan'), 'description: Plans.');
    writeSkill(join(root, '.opencode', 'skills', 'release'), 'description: Releases.');
    writeSkill(join(root, '.cursor', 'skills', 'triage'), 'description: Triages.');
    writeSkill(join(root, '.codex', 'skills', 'ignored'), 'description: Not a repository path.');

    const context = await resolveRepositoryContext({
      harness: 'pi',
      cwd: root,
      config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
    });

    expect(context.skills.map((skill) => [skill.name, skill.displayPath])).toEqual([
      ['review', '.agents/skills/review'],
      ['deploy', '.claude/skills/deploy'],
      ['plan', '.pi/skills/plan'],
      ['release', '.opencode/skills/release'],
      ['triage', '.cursor/skills/triage'],
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

  describe('with the runner home directory', () => {
    let home = '';

    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), 'shipfox-runner-home-'));
    });

    afterEach(() => {
      rmSync(home, {recursive: true, force: true});
    });

    it('reads skills from the home directory after the repository skills', async () => {
      writeSkill(join(root, '.agents', 'skills', 'review'), 'description: Repository review.');
      writeSkill(join(home, '.agents', 'skills', 'tdd'), 'description: Runner TDD.');
      writeSkill(join(home, '.claude', 'skills', 'debug'), 'description: Runner debug.');
      writeSkill(join(home, '.pi', 'agent', 'skills', 'fix'), 'description: Runner fix.');
      writeSkill(join(home, '.codex', 'skills', 'plan'), 'description: Runner plan.');
      writeSkill(join(home, '.config', 'opencode', 'skills', 'docs'), 'description: Runner docs.');
      writeSkill(join(home, '.cursor', 'skills', 'lint'), 'description: Runner lint.');
      writeSkill(join(home, '.opencode', 'skills', 'ignored'), 'description: Not a home path.');

      const context = await resolveRepositoryContext({
        harness: 'pi',
        cwd: root,
        homeDirectory: home,
        config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
      });

      expect(context.skills.map((skill) => [skill.name, skill.displayPath])).toEqual([
        ['review', '.agents/skills/review'],
        ['tdd', '~/.agents/skills/tdd'],
        ['debug', '~/.claude/skills/debug'],
        ['fix', '~/.pi/agent/skills/fix'],
        ['plan', '~/.codex/skills/plan'],
        ['docs', '~/.config/opencode/skills/docs'],
        ['lint', '~/.cursor/skills/lint'],
      ]);
    });

    it('lets a repository skill override a home skill with the same name', async () => {
      writeSkill(join(home, '.agents', 'skills', 'review'), 'description: Runner review.');
      writeSkill(join(root, '.claude', 'skills', 'review'), 'description: Repository review.');

      const context = await resolveRepositoryContext({
        harness: 'claude',
        cwd: root,
        homeDirectory: home,
        config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
      });

      expect(context.skills.map((skill) => skill.description)).toEqual(['Repository review.']);
    });

    it.each([
      ['pi', 'pi-marker'],
      ['claude', 'claude-marker'],
    ] as const)('reads the home instructions that %s prefers first', async (harness, marker) => {
      write(join(home, '.pi', 'agent', 'AGENTS.md'), 'pi-marker');
      write(join(home, '.claude', 'CLAUDE.md'), 'claude-marker');
      write(join(root, 'AGENTS.md'), 'repository-marker');
      write(join(root, 'CLAUDE.md'), 'repository-marker');

      const context = await resolveRepositoryContext({
        harness,
        cwd: root,
        homeDirectory: home,
        config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
      });

      expect(context.instructionFiles.map((file) => file.content)).toEqual([
        marker,
        'repository-marker',
      ]);
    });

    it.each([
      ['.pi/agent/AGENTS.md', ['.pi', 'agent', 'AGENTS.md']],
      ['.codex/AGENTS.md', ['.codex', 'AGENTS.md']],
      ['.config/opencode/AGENTS.md', ['.config', 'opencode', 'AGENTS.md']],
    ] as const)('falls back to ~/%s for the claude harness', async (displayPath, parts) => {
      write(join(home, ...parts), 'home-marker');

      const context = await resolveRepositoryContext({
        harness: 'claude',
        cwd: root,
        homeDirectory: home,
        config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
      });

      expect(context.instructionFiles.map((file) => file.displayPath)).toEqual([
        `~/${displayPath}`,
      ]);
    });

    it('reads one home instruction file in the order the pi harness prefers', async () => {
      write(join(home, '.codex', 'AGENTS.md'), 'codex-marker');
      write(join(home, '.config', 'opencode', 'AGENTS.md'), 'opencode-marker');
      write(join(home, '.claude', 'CLAUDE.md'), 'claude-marker');

      const context = await resolveRepositoryContext({
        harness: 'pi',
        cwd: root,
        homeDirectory: home,
        config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
      });

      expect(context.instructionFiles.map((file) => file.content)).toEqual(['codex-marker']);
    });

    it('reads no other instruction files from the home directory', async () => {
      write(join(home, 'AGENTS.md'), 'home-marker');
      write(join(home, '.agents', 'AGENTS.md'), 'home-marker');
      write(join(home, '.codex', 'AGENTS.override.md'), 'home-marker');

      const context = await resolveRepositoryContext({
        harness: 'pi',
        cwd: root,
        homeDirectory: home,
        config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
      });

      expect(context.instructionFiles).toEqual([]);
    });

    it('counts home instructions toward the size limit', async () => {
      write(join(home, '.claude', 'CLAUDE.md'), 'x'.repeat(MAX_REPOSITORY_INSTRUCTIONS_BYTES + 1));
      write(join(root, 'CLAUDE.md'), 'repository-marker');

      const context = await resolveRepositoryContext({
        harness: 'claude',
        cwd: root,
        homeDirectory: home,
        config: DEFAULT_REPOSITORY_CONTEXT_CONFIG,
      });

      expect(context.instructionFiles.map((file) => [file.displayPath, file.truncated])).toEqual([
        ['~/.claude/CLAUDE.md', true],
      ]);
    });

    it('skips home instructions when instructions are turned off', async () => {
      write(join(home, '.claude', 'CLAUDE.md'), 'claude-marker');

      const context = await resolveRepositoryContext({
        harness: 'claude',
        cwd: root,
        homeDirectory: home,
        config: {instructions: false, skills: true},
      });

      expect(context.instructionFiles).toEqual([]);
    });

    it('applies the skill selection to home skills', async () => {
      writeSkill(join(home, '.agents', 'skills', 'tdd'), 'description: Runner TDD.');
      writeSkill(join(home, '.agents', 'skills', 'debug'), 'description: Runner debug.');

      const selected = await resolveRepositoryContext({
        harness: 'pi',
        cwd: root,
        homeDirectory: home,
        config: {instructions: true, skills: ['tdd']},
      });
      const off = await resolveRepositoryContext({
        harness: 'pi',
        cwd: root,
        homeDirectory: home,
        config: {instructions: true, skills: false},
      });

      expect(selected.skills.map((skill) => skill.displayPath)).toEqual(['~/.agents/skills/tdd']);
      expect(off.skills).toEqual([]);
    });
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
