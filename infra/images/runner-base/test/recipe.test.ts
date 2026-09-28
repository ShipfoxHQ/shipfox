import {cp, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {computeRunnerBaseRecipe, readPackerVersion} from '#recipe.js';

const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const MISE_CONFIG = `[tools]
node = "24.17.0"
"npm:pnpm" = "11.7.0"
packer = "1.15.4"
`;

describe('runner base recipe', () => {
  let root: string;
  let miseConfigPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'shipfox-runner-base-recipe-'));
    await cp(packageRoot, root, {
      recursive: true,
      filter: (source) => !source.includes('node_modules') && !source.includes('/dist'),
    });
    miseConfigPath = join(root, 'mise.toml');
    await writeFile(miseConfigPath, MISE_CONFIG);
  });

  afterEach(async () => {
    await rm(root, {force: true, recursive: true});
  });

  function digest(): string {
    return computeRunnerBaseRecipe({packageRoot: root, miseConfigPath}).digest;
  }

  it('hashes the base templates and base scripts only', () => {
    const recipe = computeRunnerBaseRecipe({packageRoot: root, miseConfigPath});

    expect(recipe.files.map((file) => file.path)).toEqual([
      'build.pkr.hcl',
      'locals.pkr.hcl',
      'requirements.pkr.hcl',
      'scripts/build/clean-identity.sh',
      'scripts/build/install-docker.sh',
      'scripts/build/install-node.sh',
      'scripts/build/prepare-os.sh',
      'scripts/verify/verify-instance.sh',
      'source.pkr.hcl',
      'variable.pkr.hcl',
    ]);
    expect(recipe).toMatchObject({
      imageOs: 'ubuntu24',
      packerVersion: '1.15.4',
    });
    expect(recipe.ubuntuRelease).toBe('noble');
    expect(recipe.digest).toMatch(SHA256_DIGEST_PATTERN);
  });

  it('is deterministic for the same inputs', () => {
    expect(digest()).toBe(digest());
  });

  it.each([
    ['a provisioning script', 'scripts/build/prepare-os.sh'],
    ['a verification script', 'scripts/verify/verify-instance.sh'],
    ['a Packer template', 'source.pkr.hcl'],
    ['the plugin pins', 'requirements.pkr.hcl'],
  ])('changes when %s changes', async (_label, path) => {
    const before = digest();
    await writeFile(join(root, path), '# changed\n', {flag: 'a'});

    expect(digest()).not.toBe(before);
  });

  it('changes when the Packer pin changes', async () => {
    const before = digest();
    await writeFile(miseConfigPath, MISE_CONFIG.replace('1.15.4', '1.15.5'));

    expect(digest()).not.toBe(before);
  });

  it.each([
    ['Node', '24.17.0', '24.18.0'],
    ['pnpm', '11.7.0', '11.8.0'],
  ])('ignores %s pin changes', async (_label, pin, next) => {
    const before = digest();
    await writeFile(miseConfigPath, MISE_CONFIG.replace(pin, next));

    expect(digest()).toBe(before);
  });

  it.each([
    ['documentation', 'README.md'],
    ['build tooling', 'src/build-runner-base.ts'],
    ['tests', 'test/recipe.test.ts'],
    ['Packer validation tooling', 'scripts/verify-packer.mjs'],
    ['the package manifest', 'package.json'],
  ])('ignores %s changes', async (_label, path) => {
    const before = digest();
    await writeFile(join(root, path), '\n', {flag: 'a'});

    expect(digest()).toBe(before);
  });

  it('requires a Packer pin', () => {
    expect(() => readPackerVersion('[tools]\nnode = "24.17.0"\n')).toThrow('packer');
  });
});
