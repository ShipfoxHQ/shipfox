import {Buffer} from 'node:buffer';
import {encodeActionBundle} from '@shipfox/workflow-document';
import {stringify} from 'yaml';

export interface BundleFixture {
  gzip: Buffer;
  digest: string;
  bytes: number;
}

export async function bundleOf(files: Record<string, string>): Promise<BundleFixture> {
  const {gzip, digest, bytes} = await encodeActionBundle({
    files: Object.entries(files).map(([path, content]) => ({path, content})),
  });
  return {gzip: Buffer.from(gzip), digest, bytes};
}

export interface ActionManifestFixture {
  name?: string;
  /** `null` leaves the field out. */
  description?: string | null;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  integrations?: Record<string, unknown>;
  keywords?: string[];
  related?: string[];
}

/** The files of an `action-bundle@1`. */
export function actionFiles({
  name = 'Slack thread digest',
  description = 'Summarizes a Slack thread.',
  ...rest
}: ActionManifestFixture = {}): Record<string, string> {
  return {
    'action.yml': stringify({
      name,
      ...(description === null ? {} : {description}),
      main: 'index.mjs',
      ...rest,
    }),
    'index.mjs': 'export default async function run() {}\n',
  };
}

export interface TemplateFixture {
  title?: string;
  summary?: string;
  related?: string[];
  /** Extra steps of the workflow, as YAML lines such as `- uses: shipfox/x@1.0.0`. */
  steps?: string[];
  providers?: string[];
  slots?: string[];
}

/** The files of a `template-bundle@1`, with one role that offers `providers`. */
export function templateFiles({
  title = 'Ticket digest',
  summary = 'Digest the tickets of the day.',
  related = [],
  steps = [],
  providers = ['github'],
  slots = [],
}: TemplateFixture = {}): Record<string, string> {
  const manifest = {
    title,
    summary,
    starts: 'A ticket starts the workflow',
    related,
    roles: {tracker: {providers}},
    slots: slots.map((id) => ({id, description: `The ${id} slot`})),
  };
  const workflow = [
    'name: Digest',
    'triggers:',
    '  # part:tracker.trigger',
    'jobs:',
    '  digest:',
    '    steps:',
    '      - key: read',
    '        run: echo read',
    ...steps.map((step) => `      ${step}`),
    '',
  ].join('\n');
  const part = (provider: string) =>
    stringify({trigger: `ticket:\n  source: ${provider}_fixture\n  event: issues.opened\n`});
  return {
    'template.yaml': stringify(manifest),
    'workflow.yml': workflow,
    'GUIDE.md': '# Guide\n',
    ...Object.fromEntries(providers.map((p) => [`parts/tracker/${p}.yml`, part(p)])),
  };
}

export const ACTION_DRAFT = {
  kind: 'action',
  license: 'MIT',
  builder: {tool: '@shipfox/registry-release', version: '0.1.0', recipe: 1, mode: 'workspace'},
  dependencies: [{name: 'mdast-util-to-markdown', version: '2.1.2'}],
  path: 'libs/shared/workflow/catalog/actions/slack-thread-digest',
} as const;

export const TEMPLATE_DRAFT = {
  kind: 'template',
  license: 'MIT',
  builder: {tool: '@shipfox/registry-release', version: '0.1.0', recipe: 1},
  composition: 1,
  path: 'libs/shared/workflow/catalog/templates/ticket-digest',
} as const;

export interface PublishFixture {
  draft?: unknown;
  content: BundleFixture;
  source?: BundleFixture;
  readme?: string;
  /** Parts added after the standard ones, so a repeated name appears twice. */
  extraParts?: Record<string, string> | undefined;
}

export function sourceArchive(files: Record<string, string> = {'package.json': '{}'}) {
  return bundleOf(files);
}

/** The body and content type of a publish request, encoded as a browser would send it. */
export async function multipartRequest({
  draft,
  content,
  source,
  readme,
  extraParts = {},
}: PublishFixture) {
  const form = new FormData();
  form.set('draft', typeof draft === 'string' ? draft : JSON.stringify(draft));
  form.set('content', new Blob([new Uint8Array(content.gzip)]), 'content.gz');
  const archive = source ?? (await sourceArchive());
  form.set('source', new Blob([new Uint8Array(archive.gzip)]), 'source.gz');
  if (readme !== undefined) form.set('readme', new Blob([readme]), 'README.md');
  for (const [name, value] of Object.entries(extraParts)) form.append(name, value);
  const response = new Response(form);
  return {
    payload: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? '',
  };
}
