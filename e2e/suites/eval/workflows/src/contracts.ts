import {readdir, readFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkCaseReferences} from './contract-references.js';
import {
  type ContractBacklog,
  type ContractCase,
  type ContractExemption,
  parseContractBacklog,
  parseContractCase,
  parseContractExemption,
  parseSandboxManifest,
  parseYamlDocument,
  type SandboxManifest,
} from './contract-schema.js';
import {CaseValidationError} from './schema.js';

export interface LoadedContractCase {
  /** `<provider>/<file name>`, such as `linear/get-issue`. */
  id: string;
  path: string;
  definition: ContractCase;
}

export interface LoadedContractExemption {
  id: string;
  path: string;
  definition: ContractExemption;
}

export interface ContractFiles {
  manifest: SandboxManifest;
  backlog: ContractBacklog;
  cases: LoadedContractCase[];
  exemptions: LoadedContractExemption[];
}

const defaultContractsRoot = fileURLToPath(new URL('../cases/contracts/', import.meta.url));

async function readYamlFile(path: string): Promise<unknown> {
  return parseYamlDocument({source: await readFile(path, 'utf8'), path});
}

async function listEntries({directory, directories}: {directory: string; directories: boolean}) {
  const entries = await readdir(directory, {withFileTypes: true});
  return entries
    .filter((entry) => (directories ? entry.isDirectory() : entry.isFile()))
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.'))
    .sort();
}

function isExemptionDocument(document: unknown): boolean {
  return typeof document === 'object' && document !== null && 'exempt' in document;
}

/**
 * Loads and validates everything under `cases/contracts/`: the sandbox manifest, the backlog,
 * and the case and exemption files of each provider directory. Throws on the first invalid file.
 */
export async function loadContracts(root = defaultContractsRoot): Promise<ContractFiles> {
  const manifestPath = join(root, 'sandbox.yaml');
  const manifest = parseSandboxManifest(await readYamlFile(manifestPath), manifestPath);
  const backlogPath = join(root, 'backlog.yaml');
  const backlog = parseContractBacklog(await readYamlFile(backlogPath), backlogPath);

  const files: ContractFiles = {manifest, backlog, cases: [], exemptions: []};
  for (const provider of await listEntries({directory: root, directories: true})) {
    const directory = join(root, provider);
    for (const file of await listEntries({directory, directories: false})) {
      const path = join(directory, file);
      if (file.endsWith('.yml')) {
        throw new CaseValidationError(path, 'contract files use the `.yaml` extension');
      }
      if (!file.endsWith('.yaml')) continue;
      const id = `${provider}/${basename(file, '.yaml')}`;
      const document = await readYamlFile(path);

      if (isExemptionDocument(document)) {
        const definition = parseContractExemption(document, path);
        assertProviderDirectory({provider: definition.provider, directory: provider, path});
        files.exemptions.push({id, path, definition});
      } else {
        const definition = parseContractCase(document, path);
        assertProviderDirectory({provider: definition.provider, directory: provider, path});
        assertCaseReferences({definition, manifest, path});
        files.cases.push({id, path, definition});
      }
    }
  }
  return files;
}

function assertCaseReferences({
  definition,
  manifest,
  path,
}: {
  definition: ContractCase;
  manifest: SandboxManifest;
  path: string;
}) {
  if (manifest[definition.provider] === undefined) {
    throw new CaseValidationError(path, `provider "${definition.provider}" is not in sandbox.yaml`);
  }
  const problems = checkCaseReferences({contractCase: definition, manifest});
  if (problems.length > 0) throw new CaseValidationError(path, problems.join('\n'));
}

function assertProviderDirectory({
  provider,
  directory,
  path,
}: {
  provider: string;
  directory: string;
  path: string;
}) {
  if (provider !== directory) {
    throw new CaseValidationError(
      path,
      `provider "${provider}" does not match its directory "${directory}"`,
    );
  }
}
