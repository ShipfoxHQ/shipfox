import {
  compareRegistryVersions,
  parseRegistryPackageName,
  type RegistryActionMetadata,
  type RegistryBump,
  type RegistryVersionDocument,
} from '@shipfox/registry-format';
import {actionManifestSchema} from '@shipfox/workflow-document';
import {
  type WorkflowTemplateManifest,
  type WorkflowTemplateMetadata,
  workflowTemplateManifestSchema,
  workflowTemplateMetadataSchema,
} from '@shipfox/workflow-templates';
import type {RegistryApi} from './registry-api';

const GITHUB_ACTIONS_ISSUER = 'https://token.actions.githubusercontent.com';

export interface PackageVersion {
  version: string;
  publishedAt: string;
  bump?: RegistryBump;
  capabilityChange: boolean;
  changelog?: string;
}

export interface PackageSource {
  repository: string;
  commit: string;
  path: string;
  /** Absent when the publisher is not on GitHub, whose tree URLs are the only ones known. */
  url?: string;
}

export interface ActionDetails {
  kind: 'action';
  metadata: RegistryActionMetadata;
  dependencies: {name: string; version: string}[];
}

export interface TemplateDetails {
  kind: 'template';
  manifest: WorkflowTemplateManifest;
  metadata: WorkflowTemplateMetadata;
  /** Exact registry references of the actions the template can use. */
  actions: string[];
}

export interface PackagePage {
  package: string;
  namespace: string;
  name: string;
  title: string;
  summary: string;
  keywords: string[];
  version: string;
  publishedAt: string;
  license: string;
  digest: string;
  publisher: {displayName: string; url?: string; verified: boolean};
  source: PackageSource;
  readme?: string;
  /** Newest first. */
  versions: PackageVersion[];
  /** Only the related packages the registry knows, so a page never links to a missing one. */
  related: {package: string; title: string}[];
  details: ActionDetails | TemplateDetails;
}

/** Everything a package page shows, read from the registry API. Undefined for an unknown package. */
export async function loadPackagePage({
  api,
  namespace,
  name,
}: {
  api: RegistryApi;
  namespace: string;
  name: string;
}): Promise<PackagePage | undefined> {
  const parsed = parseRegistryPackageName(`${namespace}/${name}`);
  if (parsed === undefined) return undefined;
  const packageName = `${parsed.namespace}/${parsed.name}`;

  const [index, profile] = await Promise.all([
    api.getPackageIndex(packageName),
    api.getNamespaceProfile(parsed.namespace),
  ]);
  const entries = [...(index?.versions ?? [])].sort((a, b) =>
    compareRegistryVersions(b.version, a.version),
  );
  if (entries.length === 0) return undefined;

  const documents = await Promise.all(
    entries.map(async ({version}) => {
      const document = await api.getVersion({package: packageName, version});
      if (document === undefined) throw new Error(`The index lists ${packageName}@${version}`);
      return document;
    }),
  );
  const latest = documents[0] as RegistryVersionDocument;
  const presentation = describe(latest);

  const [readme, related] = await Promise.all([
    latest.readme ? api.getReadme({package: packageName, version: latest.version}) : undefined,
    resolveRelated({api, related: presentation.related}),
  ]);

  return {
    package: packageName,
    namespace: parsed.namespace,
    name: parsed.name,
    title: presentation.title,
    summary: presentation.summary,
    keywords: presentation.keywords,
    version: latest.version,
    publishedAt: latest.published_at,
    license: latest.license,
    digest: latest.content.digest,
    publisher: {
      displayName: profile?.display_name ?? parsed.namespace,
      ...(profile?.url === undefined ? {} : {url: profile.url}),
      verified: profile?.verified ?? false,
    },
    source: sourceOf(latest),
    ...(readme === undefined ? {} : {readme}),
    versions: entries.map((entry, position) => ({
      version: entry.version,
      publishedAt: entry.published_at,
      ...(entry.bump === undefined ? {} : {bump: entry.bump}),
      capabilityChange: entry.capability_change,
      ...(documents[position]?.changelog === undefined
        ? {}
        : {changelog: documents[position].changelog}),
    })),
    related,
    details: presentation.details,
  };
}

function describe(document: RegistryVersionDocument) {
  if (document.kind === 'action') {
    const manifest = actionManifestSchema.parse(document.manifest);
    return {
      title: manifest.name,
      summary: manifest.description ?? '',
      keywords: manifest.keywords ?? [],
      related: manifest.related ?? [],
      details: {
        kind: 'action',
        metadata: document.derived,
        dependencies: document.dependencies,
      } satisfies ActionDetails,
    };
  }
  const manifest = workflowTemplateManifestSchema.parse(document.manifest);
  return {
    title: manifest.title,
    summary: manifest.summary,
    keywords: manifest.keywords,
    related: manifest.related,
    details: {
      kind: 'template',
      manifest,
      metadata: workflowTemplateMetadataSchema.parse(document.derived),
      actions: document.actions,
    } satisfies TemplateDetails,
  };
}

async function resolveRelated({api, related}: {api: RegistryApi; related: string[]}) {
  if (related.length === 0) return [];
  const titles = new Map(
    (await api.listPackages()).map((entry) => [entry.package, entry.title] as const),
  );
  return related.flatMap((packageName) => {
    const title = titles.get(packageName);
    return title === undefined ? [] : [{package: packageName, title}];
  });
}

function sourceOf({provenance}: RegistryVersionDocument): PackageSource {
  const {repository, commit, path} = provenance;
  return {
    repository,
    commit,
    path,
    ...(provenance.issuer === GITHUB_ACTIONS_ISSUER
      ? {url: `https://github.com/${repository}/tree/${commit}/${path}`}
      : {}),
  };
}
