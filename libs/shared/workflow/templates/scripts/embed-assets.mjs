import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {parse as parseYaml} from 'yaml';

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsRoot = join(packageRoot, 'assets');
const outputPath = join(packageRoot, 'src/generated/assets.ts');
const formatterPath = resolve(packageRoot, 'node_modules/@shipfox/biome/bin/biome-format.js');
const {version: libraryVersion} = JSON.parse(
  await readFile(join(packageRoot, 'package.json'), 'utf8'),
);
const skillRoot = join(assetsRoot, 'skills');
const skillResources = [];
const skillMetadata = new Map();

for (const entry of (await readdir(skillRoot, {withFileTypes: true})).sort(byName)) {
  if (!entry.isDirectory()) continue;
  const skillPath = join(skillRoot, entry.name, 'SKILL.md');
  const markdown = await readFile(skillPath, 'utf8');
  const frontmatter = markdown.match(/^---\n(?<content>[\s\S]*?)\n---\n/u)?.groups?.content;
  if (frontmatter === undefined) throw new Error(`${skillPath} must have YAML frontmatter.`);
  const metadata = parseYaml(frontmatter);
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    metadata.name !== entry.name ||
    typeof metadata.description !== 'string' ||
    !Number.isInteger(metadata.revision) ||
    metadata.revision < 1 ||
    ['catalog_title', 'catalog_category', 'catalog_prompt'].some(
      (key) => typeof metadata[key] !== 'string' || metadata[key].length === 0,
    )
  ) {
    throw new Error(`${skillPath} has invalid skill frontmatter.`);
  }
  if (Buffer.byteLength(markdown, 'utf8') > 8 * 1024) {
    throw new Error(`${skillPath} exceeds the 8 KiB skill limit.`);
  }
  skillMetadata.set(entry.name, metadata);
  skillResources.push(createSkillResource(`${entry.name}/SKILL.md`, markdown, metadata));
  const referencesRoot = join(skillRoot, entry.name, 'references');
  const references = await readdir(referencesRoot, {withFileTypes: true}).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const reference of references.sort(byName)) {
    if (!reference.isFile() || !reference.name.endsWith('.md')) continue;
    skillResources.push(
      createSkillResource(
        `${entry.name}/references/${reference.name}`,
        await readFile(join(referencesRoot, reference.name), 'utf8'),
        metadata,
      ),
    );
  }
}

const templates = [];
for (const entry of await readdir(assetsRoot, {withFileTypes: true})) {
  if (!entry.isDirectory() || entry.name === 'skills') continue;

  const templateRoot = join(assetsRoot, entry.name);
  const manifestPath = join(templateRoot, 'template.yaml');
  const workflowPath = join(templateRoot, 'workflow.yml');
  const guidePath = join(templateRoot, 'GUIDE.md');
  const manifestText = await readFile(manifestPath, 'utf8');
  const guide = await readFile(guidePath, 'utf8');
  const parts = {};

  const roleEntries = await readdir(join(templateRoot, 'parts'), {withFileTypes: true});
  for (const roleEntry of roleEntries.sort(byName)) {
    if (!roleEntry.isDirectory()) continue;
    const roleParts = {};
    const providerEntries = await readdir(join(templateRoot, 'parts', roleEntry.name), {
      withFileTypes: true,
    });
    for (const providerEntry of providerEntries.sort(byName)) {
      if (!providerEntry.isFile() || !providerEntry.name.endsWith('.yml')) continue;
      const provider = providerEntry.name.slice(0, -4);
      const partPath = join(templateRoot, 'parts', roleEntry.name, providerEntry.name);
      const parsedPart = parseYaml(await readFile(partPath, 'utf8'));
      if (
        parsedPart === null ||
        typeof parsedPart !== 'object' ||
        Array.isArray(parsedPart) ||
        Object.values(parsedPart).some((value) => typeof value !== 'string')
      ) {
        throw new Error(
          `Invalid provider part file ${partPath}: expected a YAML map of string blocks.`,
        );
      }
      roleParts[provider] = parsedPart;
    }
    parts[roleEntry.name] = roleParts;
  }

  templates.push({
    manifest: manifestText,
    workflow: await readFile(workflowPath, 'utf8'),
    guide,
    parts,
  });
  const manifest = parseYaml(manifestText);
  const referencePath = `create-workflow-from-template/references/${manifest.id}.md`;
  if (!skillResources.some((resource) => resource.name === referencePath)) {
    skillResources.push(
      createSkillResource(referencePath, guide, {
        ...skillMetadata.get('create-workflow-from-template'),
        catalog_title: manifest.title,
      }),
    );
  }
}

templates.sort((left, right) => left.manifest.localeCompare(right.manifest));
skillResources.sort((left, right) => left.uri.localeCompare(right.uri));
const skillIndex = `${[
  'Shipfox skills are first-party instructions.',
  ...skillResources
    .filter((resource) => resource.name.endsWith('/SKILL.md'))
    .map((resource) => `${resource.name.split('/')[0]}: ${resource.description}`),
].join('\n')}\n`;
const skillManifest = JSON.stringify({
  library_version: libraryVersion,
  files: skillResources.map(({uri, size, sha256}) => ({uri, size, sha256})),
});
skillResources.unshift(
  createSkillResource('index', skillIndex, {
    description: 'Find the Shipfox skill for a multi-step workflow task.',
    catalog_title: 'Shipfox skill index',
  }),
  createSkillResource('manifest', skillManifest, {
    description: 'Digest and size of every Shipfox skill file.',
    catalog_title: 'Shipfox skill manifest',
  }),
);
const generated = `/* Generated by scripts/embed-assets.mjs. Do not edit by hand. */
/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: Workflow expressions are embedded as literal strings. */

import type {EmbeddedWorkflowTemplateAsset} from '../loader.js';
import type {SkillResource} from '../skills.js';

export const embeddedSkillResources: readonly SkillResource[] = ${JSON.stringify(skillResources, null, 2)};

export const embeddedWorkflowTemplateAssets: readonly EmbeddedWorkflowTemplateAsset[] = ${JSON.stringify(templates, null, 2)};
`;
await writeFormattedIfChanged(generated);

async function writeFormattedIfChanged(generated) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-workflow-template-assets-'));
  const temporaryPath = join(temporaryRoot, 'assets.ts');

  try {
    await writeFile(temporaryPath, generated);
    await execFileAsync(process.execPath, [formatterPath, '--write', temporaryPath], {
      cwd: packageRoot,
    });
    const formatted = await readFile(temporaryPath, 'utf8');
    const existing = await readFile(outputPath, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (existing !== formatted) await writeFile(outputPath, formatted);
  } finally {
    await rm(temporaryRoot, {recursive: true, force: true});
  }
}

function byName(left, right) {
  return left.name.localeCompare(right.name);
}

function createSkillResource(path, text, metadata) {
  const uri = `skill://shipfox/${path}`;
  return {
    uri,
    name: path,
    title: metadata.catalog_title,
    description: metadata.description,
    ...(metadata.revision === undefined ? {} : {revision: metadata.revision}),
    ...(metadata.catalog_category === undefined
      ? {}
      : {catalogCategory: metadata.catalog_category}),
    ...(metadata.catalog_prompt === undefined ? {} : {catalogPrompt: metadata.catalog_prompt}),
    mimeType: path === 'manifest' ? 'application/json' : 'text/markdown',
    size: Buffer.byteLength(text, 'utf8'),
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    text,
  };
}
