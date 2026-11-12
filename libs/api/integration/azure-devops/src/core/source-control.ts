import {Buffer} from 'node:buffer';
import {randomUUID} from 'node:crypto';
import {
  asRecord,
  buildProviderRepositoryId,
  type CheckoutCredentials,
  type CheckoutRepositoryAuthorizationState,
  type CheckoutSpec,
  type CheckoutTarget,
  type CreateCheckoutCredentialsInput,
  type CreateCheckoutSpecInput,
  type FetchFileInput,
  type FilePage,
  type FileSnapshot,
  isRecord,
  isSafeCheckoutRef,
  isValidGitObjectId,
  isValidResolvableRef,
  isValidTriggerRef,
  type ListFilesInput,
  type ListRepositoriesInput,
  MAX_REPOSITORY_FILE_BYTES,
  nonEmptyString,
  normalizeCheckoutTarget as normalizeTarget,
  parseProviderRepositoryId,
  type RepositoryPage,
  type RepositorySnapshot,
  type ResolvedRef,
  type ResolveRefInput,
  type ResolveRepositoryInput,
  type SourceControlProvider,
  type TriggerReference,
} from '@shipfox/api-integration-spi';
import type {
  AzureDevOpsApiClient,
  AzureDevOpsRepository,
  AzureDevOpsRepositoryRef,
} from '#api/client.js';
import {config} from '#config.js';
import {
  type AzureDevOpsClientFactory,
  type AzureDevOpsConnectionCredentials,
  type AzureDevOpsIntegrationConnection,
  azureDevOpsProviderKind,
} from './credentials.js';
import {AzureDevOpsIntegrationProviderError} from './errors.js';

const TRAILING_SLASHES_RE = /\/+$/;
const REFS_HEADS_PREFIX = 'refs/heads/';
const REFS_TAGS_PREFIX = 'refs/tags/';
const ZERO_OBJECT_ID_RE = /^0+$/;
// Azure DevOps ignores the user name of a PAT or OAuth token on git-over-HTTPS; any non-empty
// value works, so a fixed, recognizable one is used.
const CHECKOUT_USERNAME = 'shipfox';

export class AzureDevOpsSourceControlProvider
  implements SourceControlProvider<AzureDevOpsIntegrationConnection>
{
  readonly checkoutRepositoryAuthorization: CheckoutRepositoryAuthorizationState = 'enforced';

  constructor(
    private readonly createClient: AzureDevOpsClientFactory,
    private readonly credentials: AzureDevOpsConnectionCredentials,
  ) {}

  async listRepositories(
    input: ListRepositoriesInput<AzureDevOpsIntegrationConnection>,
  ): Promise<RepositoryPage> {
    const client = await this.client(input.connection);
    const needle = input.search?.trim().toLowerCase();
    // Azure DevOps returns every repository of the organization in one response, so search and
    // paging run here over the full list.
    const matched = (await client.listRepositories())
      .filter(isUsableRepository)
      .map(toRepositorySnapshot)
      .filter((repository) => !needle || repository.fullName.toLowerCase().includes(needle))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    const offset = parseOffset(input.cursor);
    const page = matched.slice(offset, offset + input.limit);
    const consumed = offset + page.length;
    return {
      repositories: page,
      nextCursor: consumed < matched.length ? String(consumed) : null,
    };
  }

  async resolveRepository(
    input: ResolveRepositoryInput<AzureDevOpsIntegrationConnection>,
  ): Promise<RepositorySnapshot> {
    const locator = parseRepositoryLocator(input.externalRepositoryId);
    const client = await this.client(input.connection);
    return toRepositorySnapshot(requireUsable(await client.getRepository(locator)));
  }

  async listFiles(input: ListFilesInput<AzureDevOpsIntegrationConnection>): Promise<FilePage> {
    const locator = parseRepositoryLocator(input.externalRepositoryId);
    const client = await this.client(input.connection);
    const commitSha = await client.resolveRef({...locator, ref: input.ref});
    const tree = await client.listTree({...locator, commitSha});
    if (tree.truncated) {
      throw new AzureDevOpsIntegrationProviderError(
        'too-many-files',
        `Azure DevOps repository tree for ${input.externalRepositoryId} is too large to enumerate`,
      );
    }

    const prefix = input.prefix.replace(TRAILING_SLASHES_RE, '');
    const matched = tree.blobs
      .filter((blob) => prefixMatches(blob.path, prefix))
      .sort((a, b) => a.path.localeCompare(b.path));
    const offset = parseOffset(input.cursor);
    const page = matched.slice(offset, offset + input.limit);
    const consumed = offset + page.length;
    return {
      files: page.map((blob) => ({path: blob.path, type: blob.type, size: blob.size})),
      nextCursor: consumed < matched.length ? String(consumed) : null,
    };
  }

  async fetchFile(input: FetchFileInput<AzureDevOpsIntegrationConnection>): Promise<FileSnapshot> {
    const locator = parseRepositoryLocator(input.externalRepositoryId);
    const client = await this.client(input.connection);
    const commitSha = await client.resolveRef({...locator, ref: input.ref});
    const file = await client.fetchFileContent({...locator, path: input.path, commitSha});
    if (
      file.size > MAX_REPOSITORY_FILE_BYTES ||
      Buffer.byteLength(file.content, 'utf8') > MAX_REPOSITORY_FILE_BYTES
    ) {
      throw new AzureDevOpsIntegrationProviderError(
        'content-too-large',
        'Azure DevOps file content is larger than the supported limit',
      );
    }
    return {path: file.path, ref: input.ref, content: file.content};
  }

  resolveTriggerReference(payload: unknown): TriggerReference | null {
    if (!isRecord(payload)) return null;
    const resource = asRecord(payload.resource);
    if (!resource) return null;
    const eventType = nonEmptyString(payload.eventType);
    if (eventType === 'git.push') return pushReference(resource);
    if (eventType?.startsWith('git.pullrequest.')) return pullRequestReference(resource);
    return null;
  }

  async resolveRef(input: ResolveRefInput<AzureDevOpsIntegrationConnection>): Promise<ResolvedRef> {
    if (!isValidResolvableRef(input.ref)) {
      throw new AzureDevOpsIntegrationProviderError(
        'ref-invalid',
        `Azure DevOps ref ${JSON.stringify(input.ref)} is not a resolvable branch or tag name`,
      );
    }
    const locator = parseRepositoryLocator(input.externalRepositoryId);
    const client = await this.client(input.connection);

    for (const lookup of refLookups(client, locator, input.ref)) {
      try {
        return {ref: input.ref, commit: (await lookup()).commitSha};
      } catch (error) {
        if (!isRefNotFound(error)) throw error;
      }
    }

    // Surface repository-not-found for a missing repository instead of a misleading ref error.
    await client.getRepository(locator);
    throw new AzureDevOpsIntegrationProviderError(
      'ref-not-found',
      `Azure DevOps ref ${JSON.stringify(input.ref)} does not resolve to a branch or tag`,
    );
  }

  async createCheckoutSpec(
    input: CreateCheckoutSpecInput<AzureDevOpsIntegrationConnection>,
  ): Promise<CheckoutSpec> {
    const requestedRef = input.ref?.trim();
    if (requestedRef) assertSafeCheckoutRef(requestedRef);
    const target = normalizeCheckoutTarget(input);
    const client = await this.client(input.connection);
    const repository = requireUsable(await client.getRepository(checkoutLocator(target)));
    const ref = requestedRef || (repository.defaultBranch as string);
    assertSafeCheckoutRef(ref);

    const credentials = await this.createCheckoutCredentials({
      connection: input.connection,
      target,
      permissions: input.permissions ?? {contents: 'read'},
    });
    return {
      repositoryUrl: withoutUserInfo(repository.remoteUrl),
      ref,
      target: {kind: 'external-id', externalRepositoryId: externalRepositoryId(repository)},
      credentials,
    };
  }

  async createCheckoutCredentials(
    input: CreateCheckoutCredentialsInput<AzureDevOpsIntegrationConnection>,
  ): Promise<CheckoutCredentials> {
    checkoutLocator(normalizeCheckoutTarget(input));
    const credential = await this.credentials.resolve(input.connection);
    // The connection credential is long-lived and cannot be narrowed to one repository or to
    // read-only per request, so checkout reuses it. `expiresAt` is a synthetic field for old
    // runners; renewal happens only when git rejects the credential.
    let generation = randomUUID();
    while (generation === input.rejectedGeneration) generation = randomUUID();
    return {
      username: CHECKOUT_USERNAME,
      token: credential.token,
      expiresAt: new Date(Date.now() + config.AZURE_DEVOPS_CHECKOUT_TTL_SECONDS * 1000),
      generation,
      renewal: {mode: 'on-rejection'},
    };
  }

  private async client(
    connection: AzureDevOpsIntegrationConnection,
  ): Promise<AzureDevOpsApiClient> {
    return this.createClient({
      organization: connection.externalAccountId,
      credential: await this.credentials.resolve(connection),
    });
  }
}

function refLookups(
  client: AzureDevOpsApiClient,
  locator: AzureDevOpsRepositoryRef,
  ref: string,
): Array<() => Promise<{commitSha: string}>> {
  const name = providerRefName(ref);
  const branch = () => client.getBranch({...locator, branch: name});
  const tag = () => client.getTag({...locator, tag: name});
  if (ref.startsWith(REFS_TAGS_PREFIX)) return [tag];
  if (ref.startsWith(REFS_HEADS_PREFIX)) return [branch];
  return [branch, tag];
}

function pushReference(resource: Record<string, unknown>): TriggerReference | null {
  const refUpdates = Array.isArray(resource.refUpdates) ? resource.refUpdates : [];
  const update = asRecord(refUpdates[0]);
  const commit = nonEmptyString(update?.newObjectId);
  // A push whose new object id is all zeros deleted the ref; there is nothing to run.
  if (commit && ZERO_OBJECT_ID_RE.test(commit)) return null;
  return buildTriggerReference(
    repositoryIdFromPayload(asRecord(resource.repository)),
    nonEmptyString(update?.name),
    commit,
    nonEmptyString(asRecord(resource.pushedBy)?.uniqueName),
  );
}

function pullRequestReference(resource: Record<string, unknown>): TriggerReference | null {
  // A pull request from a fork runs code from outside the repository; never trigger on it.
  if (resource.forkSource !== undefined && resource.forkSource !== null) return null;
  return buildTriggerReference(
    repositoryIdFromPayload(asRecord(resource.repository)),
    nonEmptyString(resource.sourceRefName),
    nonEmptyString(asRecord(resource.lastMergeSourceCommit)?.commitId),
    nonEmptyString(asRecord(resource.createdBy)?.uniqueName),
  );
}

function buildTriggerReference(
  repositoryId: string | null,
  ref: string | null,
  commit: string | null,
  actor: string | null,
): TriggerReference | null {
  if (!repositoryId || !ref || !commit) return null;
  if (!isValidGitObjectId(commit) || !isValidTriggerRef(ref)) return null;
  return {
    externalRepositoryId: buildProviderRepositoryId(azureDevOpsProviderKind, repositoryId),
    ref,
    commit,
    actor,
  };
}

function repositoryIdFromPayload(repository: Record<string, unknown> | null): string | null {
  const repositoryId = nonEmptyString(repository?.id);
  const projectId = nonEmptyString(asRecord(repository?.project)?.id);
  return repositoryId && projectId ? `${projectId}/${repositoryId}` : null;
}

function normalizeCheckoutTarget(input: {
  target?: CheckoutTarget | undefined;
  externalRepositoryId?: string | undefined;
}): CheckoutTarget {
  const result = normalizeTarget(input);
  if (result.status === 'valid') return result.target;
  if (result.status === 'ambiguous') {
    throw new AzureDevOpsIntegrationProviderError(
      'provider-rejected',
      'Checkout input cannot include both a target and an external repository id',
    );
  }
  throw new AzureDevOpsIntegrationProviderError(
    'repository-not-found',
    'Checkout input must include exactly one target or external repository id',
  );
}

// Azure DevOps accepts a project name or id and a repository name or id in the same URL slots,
// so a name target (project/repository) and an id target address the API the same way.
function checkoutLocator(target: CheckoutTarget): AzureDevOpsRepositoryRef {
  if (target.kind === 'external-id') return parseRepositoryLocator(target.externalRepositoryId);
  if (!isSafeLocatorPart(target.owner) || !isSafeLocatorPart(target.name)) {
    throw new AzureDevOpsIntegrationProviderError(
      'repository-not-found',
      `Azure DevOps repository ${target.owner}/${target.name} is not a valid project/repository name`,
    );
  }
  return {projectId: target.owner, repositoryId: target.name};
}

function parseRepositoryLocator(externalRepositoryId: string): AzureDevOpsRepositoryRef {
  const value = parseProviderRepositoryId(externalRepositoryId, azureDevOpsProviderKind);
  const parts = value.split('/');
  const [projectId, repositoryId] = parts;
  if (
    parts.length !== 2 ||
    !projectId ||
    !repositoryId ||
    !isSafeLocatorPart(projectId) ||
    !isSafeLocatorPart(repositoryId)
  ) {
    throw new AzureDevOpsIntegrationProviderError(
      'repository-not-found',
      `Azure DevOps repository id ${externalRepositoryId} must follow the form ${azureDevOpsProviderKind}:<projectId>/<repositoryId>`,
    );
  }
  return {projectId, repositoryId};
}

function isSafeLocatorPart(value: string): boolean {
  return value.length > 0 && value !== '.' && value !== '..' && !value.includes('/');
}

function assertSafeCheckoutRef(ref: string): void {
  if (!isSafeCheckoutRef(ref)) {
    throw new AzureDevOpsIntegrationProviderError(
      'ref-invalid',
      `Azure DevOps checkout ref ${JSON.stringify(ref)} is not a safe git ref`,
    );
  }
}

function isUsableRepository(repository: AzureDevOpsRepository): boolean {
  return !repository.isDisabled && repository.defaultBranch !== null;
}

function requireUsable(repository: AzureDevOpsRepository): AzureDevOpsRepository {
  if (repository.isDisabled) {
    throw new AzureDevOpsIntegrationProviderError(
      'repository-not-found',
      `Azure DevOps repository ${repository.projectName}/${repository.name} is disabled`,
    );
  }
  if (repository.defaultBranch === null) {
    throw new AzureDevOpsIntegrationProviderError(
      'ref-not-found',
      `Azure DevOps repository ${repository.projectName}/${repository.name} is empty and has no default branch`,
    );
  }
  return repository;
}

function externalRepositoryId(repository: AzureDevOpsRepository): string {
  return buildProviderRepositoryId(
    azureDevOpsProviderKind,
    `${repository.projectId}/${repository.id}`,
  );
}

function toRepositorySnapshot(repository: AzureDevOpsRepository): RepositorySnapshot {
  return {
    externalRepositoryId: externalRepositoryId(repository),
    owner: repository.projectName,
    name: repository.name,
    fullName: `${repository.projectName}/${repository.name}`,
    defaultBranch: repository.defaultBranch ?? '',
    // Azure Repos are never anonymous-readable at the repository level; project visibility is
    // not part of the repository payload.
    visibility: 'private',
    cloneUrl: withoutUserInfo(repository.remoteUrl),
    htmlUrl: repository.webUrl,
  };
}

// Azure DevOps puts the organization name in the user-info part of remoteUrl
// (https://contoso@dev.azure.com/...); git would then prompt for that user, so strip it.
function withoutUserInfo(remoteUrl: string): string {
  const url = new URL(remoteUrl);
  url.username = '';
  url.password = '';
  return url.toString();
}

function isRefNotFound(error: unknown): boolean {
  return error instanceof AzureDevOpsIntegrationProviderError && error.reason === 'ref-not-found';
}

function providerRefName(ref: string): string {
  if (ref.startsWith(REFS_HEADS_PREFIX)) return ref.slice(REFS_HEADS_PREFIX.length);
  if (ref.startsWith(REFS_TAGS_PREFIX)) return ref.slice(REFS_TAGS_PREFIX.length);
  return ref;
}

function prefixMatches(path: string, prefix: string): boolean {
  if (!prefix) return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

function parseOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const offset = Number.parseInt(cursor, 10);
  return Number.isNaN(offset) || offset < 0 ? 0 : offset;
}
