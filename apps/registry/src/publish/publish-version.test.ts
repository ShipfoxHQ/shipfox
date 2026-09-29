import {generateKeyPairSync} from 'node:crypto';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {closeApp} from '@shipfox/node-fastify';
import {verifyRegistryVersionEnvelope} from '@shipfox/registry-format';
import {and, eq} from 'drizzle-orm';
import {blobKey} from '#blobs.js';
import {db} from '#db/db.js';
import {audit} from '#db/schema/audit.js';
import {packages} from '#db/schema/packages.js';
import {versions} from '#db/schema/versions.js';
import {loadSigningKey} from '#signing-key.js';
import {
  ACTION_DRAFT,
  actionFiles,
  bundleOf,
  multipartRequest,
  sourceArchive,
  TEMPLATE_DRAFT,
  templateFiles,
} from '#test/fixtures/packages.js';
import {
  documentOf,
  envelopeOf,
  type PublishApp,
  type PublishResponse,
  publishTokenFor,
  startPublishApp,
} from '#test/fixtures/publisher.js';
import {
  BOOTSTRAP_YAML,
  createTemporaryRegistry,
  resetRegistryDatabase,
} from '#test/fixtures/registry.js';
import {testSigningKey} from '#test/fixtures/signing-key.js';

const SOURCE_PART = /name="source"/;
const CONTENT_FILENAME = /; filename="content.gz"/;

describe('PUT /v1/packages/:namespace/:name/versions/:version', () => {
  const signingKey = testSigningKey();
  let registry: Awaited<ReturnType<typeof createTemporaryRegistry>>;
  let publisher: PublishApp;

  async function start(hooks: string[] = []) {
    publisher = await startPublishApp({
      signingKey,
      storage: registry.storage,
      bootstrapPath: await registry.writeBootstrap(BOOTSTRAP_YAML),
      hooks,
    });
  }

  beforeEach(async () => {
    registry = await createTemporaryRegistry();
    await resetRegistryDatabase();
    await start();
  });

  afterEach(async () => {
    await closeApp();
    await registry.cleanup();
  });

  const publishAction = async (
    params: Parameters<PublishApp['publish']>[0] extends infer P ? Partial<P> : never = {},
  ) =>
    publisher.publish({
      draft: ACTION_DRAFT,
      content: await bundleOf(actionFiles()),
      ...params,
    });

  const publishTemplate = async (
    params: Parameters<PublishApp['publish']>[0] extends infer P ? Partial<P> : never = {},
  ) =>
    publisher.publish({
      name: 'ticket-digest',
      draft: TEMPLATE_DRAFT,
      content: await bundleOf(templateFiles()),
      ...params,
    });

  const storedVersions = (name = 'shipfox/slack-thread-digest') =>
    db().select().from(versions).where(eq(versions.package, name));
  const auditRows = () => db().select().from(audit).orderBy(audit.at);

  describe('publishing an action', () => {
    it('signs a version document that a trusting instance verifies', async () => {
      const content = await bundleOf(actionFiles());

      const response = await publishAction({content, readme: '# Digest\n'});

      expect(response.statusCode).toBe(201);
      const {document} = await verifyRegistryVersionEnvelope({
        envelope: response.json(),
        trustedKeys: [signingKey.publicKey],
        expected: {package: 'shipfox/slack-thread-digest', version: '1.0.0', kind: 'action'},
      });
      expect(document).toMatchObject({
        visibility: 'public',
        license: 'MIT',
        content: {digest: content.digest, bytes: content.bytes, format: 'action-bundle@1'},
        source: {format: 'source-archive@1'},
        readme: {bytes: '# Digest\n'.length},
        derived: {integrations: [], size: content.bytes},
        dependencies: ACTION_DRAFT.dependencies,
        actions: [],
        builder: ACTION_DRAFT.builder,
        provenance: {
          repository: 'ShipfoxHQ/shipfox',
          repository_id: '812345678',
          commit: '3066dabaa0000000000000000000000000000000',
          path: ACTION_DRAFT.path,
        },
      });
      expect(document.bump).toBeUndefined();
    });

    it('stores the package, the version, the blobs, and an audit row', async () => {
      const content = await bundleOf(actionFiles({keywords: ['slack']}));
      const source = await sourceArchive({'package.json': '{"name":"digest"}'});

      const response = await publishAction({content, source, readme: '# Digest\n'});

      const envelope = envelopeOf(response);
      const [pkg] = await db().select().from(packages);
      expect(pkg).toMatchObject({
        name: 'shipfox/slack-thread-digest',
        namespace: 'shipfox',
        kind: 'action',
        visibility: 'public',
        title: 'Slack thread digest',
        summary: 'Summarizes a Slack thread.',
        keywords: ['slack'],
        latestVersion: '1.0.0',
      });
      const [version] = await storedVersions();
      expect(version).toMatchObject({
        version: '1.0.0',
        envelope,
        contentDigest: content.digest,
        sourceDigest: source.digest,
        readme: '# Digest\n',
        bump: null,
        capabilityChange: false,
      });
      expect(version?.document).toEqual(documentOf(envelope));
      expect((await registry.storage.get(blobKey(content.digest)))?.body).toEqual(content.gzip);
      expect((await registry.storage.get(blobKey(source.digest)))?.body).toEqual(source.gzip);
      expect(await auditRows()).toMatchObject([
        {
          event: 'version-published',
          outcome: 'accepted',
          namespace: 'shipfox',
          package: 'shipfox/slack-thread-digest',
          version: '1.0.0',
        },
      ]);
    });

    it('records the derived capabilities of the manifest', async () => {
      const content = await bundleOf(
        actionFiles({
          inputs: {channel: {type: 'string', required: true}},
          integrations: {slack: {provider: 'slack', include: ['conversations.history']}},
        }),
      );

      const response = await publishAction({content});

      expect(documentOf(envelopeOf(response)).derived).toMatchObject({
        integrations: ['slack'],
        capabilities: {
          slack: {provider: 'slack', selectors: ['conversations.history'], allow_write: false},
        },
      });
    });
  });

  describe('publishing a template', () => {
    it('lists the exact registry actions that any binding of the workflow uses', async () => {
      await publishAction();
      const content = await bundleOf(
        templateFiles({
          steps: [
            '- key: digest',
            '  uses: shipfox/slack-thread-digest@1.0.0',
            '- key: local',
            '  uses: ./actions/local',
          ],
        }),
      );

      const response = await publishTemplate({content});

      expect(response.statusCode).toBe(201);
      expect(documentOf(envelopeOf(response))).toMatchObject({
        kind: 'template',
        content: {format: 'template-bundle@1'},
        composition: 1,
        actions: ['shipfox/slack-thread-digest@1.0.0'],
        derived: {integrations: ['github']},
      });
      const [pkg] = await db().select().from(packages).where(eq(packages.kind, 'template'));
      expect(pkg).toMatchObject({title: 'Ticket digest', integrations: ['github']});
    });

    it('refuses a template that uses an action the registry does not hold', async () => {
      await publishAction();
      const content = await bundleOf(
        templateFiles({steps: ['- key: digest', '  uses: shipfox/slack-thread-digest@9.9.9']}),
      );

      const response = await publishTemplate({content});

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({code: 'action-not-found'});
      expect(await storedVersions('shipfox/ticket-digest')).toEqual([]);
    });

    it('publishes two templates that link to each other', async () => {
      const first = await publishTemplate({
        name: 'first-digest',
        content: await bundleOf(templateFiles({related: ['shipfox/second-digest']})),
      });
      const second = await publishTemplate({
        name: 'second-digest',
        content: await bundleOf(templateFiles({related: ['shipfox/first-digest']})),
      });

      expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
    });

    it.each([
      'shipfox/slack-thread-digest@latest',
      'shipfox/slack-thread-digest',
    ])('refuses a registry reference that is not pinned: %s', async (uses) => {
      await publishAction();
      const content = await bundleOf(templateFiles({steps: ['- key: digest', `  uses: ${uses}`]}));

      const response = await publishTemplate({content});

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({code: 'invalid-template'});
    });

    it('refuses a composition format the registry cannot write', async () => {
      const response = await publishTemplate({draft: {...TEMPLATE_DRAFT, composition: 99}});

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({code: 'unsupported-composition'});
    });
  });

  describe('retrying a publish', () => {
    it('publishes after a crash between the blob writes and the transaction', async () => {
      const content = await bundleOf(actionFiles());
      const source = await sourceArchive();
      vi.spyOn(db(), 'transaction').mockRejectedValueOnce(new Error('connection lost'));

      const crashed = await publishAction({content, source});
      const afterCrash = {
        blob: (await registry.storage.get(blobKey(content.digest)))?.body,
        versions: await storedVersions(),
      };
      const retried = await publishAction({content, source});

      expect(crashed.statusCode).toBe(500);
      expect(afterCrash).toEqual({blob: content.gzip, versions: []});
      expect(retried.statusCode).toBe(201);
      expect(await storedVersions()).toHaveLength(1);
    });

    it('returns the stored envelope after the commit, with its first publication time', async () => {
      const content = await bundleOf(actionFiles());
      const first = await publishAction({content});

      const again = await publishAction({content});

      expect(again.statusCode).toBe(200);
      expect(envelopeOf(again)).toEqual(envelopeOf(first));
      expect(await storedVersions()).toHaveLength(1);
      expect((await auditRows()).map(({event}) => event)).toEqual([
        'version-published',
        'version-publish-retried',
      ]);
    });

    it('commits once when the same request arrives twice at the same time', async () => {
      const content = await bundleOf(actionFiles());

      const responses = await Promise.all([publishAction({content}), publishAction({content})]);

      expect(responses.map(({statusCode}) => statusCode).sort()).toEqual([200, 201]);
      expect(envelopeOf(responses[0] as PublishResponse)).toEqual(
        envelopeOf(responses[1] as PublishResponse),
      );
      expect(await storedVersions()).toHaveLength(1);
    });

    it('answers 409 when the same version arrives with other content', async () => {
      const first = await publishAction();

      const changed = await publishAction({
        content: await bundleOf(actionFiles({description: 'Summarizes a thread differently.'})),
      });

      expect(changed.statusCode).toBe(409);
      expect(changed.json()).toMatchObject({code: 'changed-without-version-bump'});
      expect((await storedVersions())[0]?.envelope).toEqual(envelopeOf(first));
    });
  });

  describe('version rules', () => {
    const withInput = (extra: Record<string, unknown> = {}) =>
      bundleOf(
        actionFiles({
          inputs: {channel: {type: 'string', required: true}, ...extra},
        }),
      );

    it('accepts the bump the changes need and stores it', async () => {
      await publishAction({content: await withInput()});

      const minor = await publishAction({
        version: '1.1.0',
        content: await withInput({limit: {type: 'number'}}),
      });

      expect(minor.statusCode).toBe(201);
      expect(documentOf(envelopeOf(minor)).bump).toBe('minor');
      const stored = await storedVersions();
      expect(stored.find(({version}) => version === '1.1.0')?.bump).toBe('minor');
    });

    it('refuses a version whose step is smaller than the changes need', async () => {
      await publishAction({content: await withInput()});

      const patch = await publishAction({
        version: '1.0.1',
        content: await bundleOf(actionFiles()),
      });

      expect(patch.statusCode).toBe(422);
      expect(patch.json()).toMatchObject({code: 'bump-too-low'});
      expect(patch.json<{details: {message: string}}>().details.message).toContain(
        'need a major bump',
      );
    });

    it('marks a version that turns on writes as a capability change', async () => {
      const integrations = (allowWrite: boolean) => ({
        slack: {provider: 'slack', include: ['chat.postMessage'], allow_write: allowWrite},
      });
      await publishAction({
        content: await bundleOf(actionFiles({integrations: integrations(false)})),
      });

      const response = await publishAction({
        version: '2.0.0',
        content: await bundleOf(actionFiles({integrations: integrations(true)})),
      });

      expect(response.statusCode).toBe(201);
      const [row] = (await storedVersions()).filter(({version}) => version === '2.0.0');
      expect(row).toMatchObject({bump: 'major', capabilityChange: true});
    });

    it('compares with the highest version below, and leaves the latest card alone', async () => {
      await publishAction({version: '2.0.0'});

      const backport = await publishAction({
        version: '1.5.0',
        content: await bundleOf(actionFiles({description: 'An older line.'})),
      });

      expect(backport.statusCode).toBe(201);
      const [pkg] = await db().select().from(packages);
      expect(pkg).toMatchObject({latestVersion: '2.0.0', summary: 'Summarizes a Slack thread.'});
    });

    it('refreshes the card fields when the new version is the highest', async () => {
      await publishAction();

      await publishAction({
        version: '1.0.1',
        content: await bundleOf(
          actionFiles({name: 'Thread digest', description: 'A new summary.'}),
        ),
      });

      const [pkg] = await db().select().from(packages);
      expect(pkg).toMatchObject({
        latestVersion: '1.0.1',
        title: 'Thread digest',
        summary: 'A new summary.',
      });
    });

    it('refuses to publish a template under the name of an action', async () => {
      await publishAction();

      const response = await publishTemplate({name: 'slack-thread-digest'});

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({code: 'kind-mismatch'});
    });
  });

  describe('refusals', () => {
    it.each([
      ['a reserved name', {name: 'github'}, 403, 'reserved-name'],
      ['a name under a reserved prefix', {name: 'shipfox-labs'}, 403, 'reserved-name'],
      ['a name that is not a slug', {name: 'Digest'}, 400, 'invalid-package-name'],
      ['a version with a leading zero', {version: '01.0.0'}, 400, 'invalid-package-name'],
      ['a version that is a range', {version: '1.0'}, 400, 'invalid-package-name'],
    ])('refuses %s', async (_name, params, status, code) => {
      const response = await publishAction(params);

      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({code});
      expect(await db().select().from(versions)).toEqual([]);
    });

    it('refuses a namespace other than the token’s', async () => {
      const token = await publishTokenFor({signingKey, namespace: 'shipfox'});

      const response = await publishAction({namespace: 'acme', token});

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({code: 'namespace-mismatch'});
    });

    it('refuses a suspended namespace', async () => {
      const token = await publishTokenFor({signingKey, namespace: 'acme'});

      const response = await publishAction({namespace: 'acme', token});

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({code: 'namespace-suspended'});
    });

    it.each([
      ['no token', null],
      ['a token that is not a JWT', 'not-a-token'],
      ['a token signed by another key', 'other-key'],
    ])('answers 401 for %s, and records nothing', async (_name, token) => {
      const bearer =
        token === 'other-key'
          ? await publishTokenFor({
              signingKey: loadSigningKey({
                pem: generateKeyPairSync('ed25519')
                  .privateKey.export({format: 'pem', type: 'pkcs8'})
                  .toString(),
                keyid: 'test-key',
              }),
            })
          : token;

      const response = await publishAction({token: bearer});

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({code: 'invalid-publish-token'});
      expect(await auditRows()).toEqual([]);
    });

    it.each([
      ['a license that is not SPDX', {draft: {...ACTION_DRAFT, license: 'Do what you want'}}],
      ['a README over 64 KiB', {readme: 'x'.repeat(64 * 1024 + 1)}],
    ])('refuses %s', async (_name, params) => {
      const response = await publishAction(params);

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({code: 'invalid-metadata'});
    });

    it.each([
      ['no description', actionFiles({description: null})],
      ['a description over 160 characters', actionFiles({description: 'x'.repeat(161)})],
    ])('refuses an action with %s', async (_name, files) => {
      const response = await publishAction({content: await bundleOf(files)});

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({code: 'invalid-metadata'});
    });

    it('accepts an SPDX expression as the license', async () => {
      const response = await publishAction({
        draft: {...ACTION_DRAFT, license: 'MIT OR Apache-2.0'},
      });

      expect(response.statusCode).toBe(201);
    });

    it.each([
      ['a draft that is not JSON', 'not json'],
      [
        'a draft with a field it does not know',
        JSON.stringify({...ACTION_DRAFT, digest: 'sha256:0'}),
      ],
      ['a draft without a license', JSON.stringify({...ACTION_DRAFT, license: undefined})],
    ])('refuses %s', async (_name, draft) => {
      const response = await publishAction({draft});

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({code: 'invalid-draft'});
    });

    it.each([
      ['content that is not gzip', {gzip: Buffer.from('nope'), digest: 'sha256:0', bytes: 4}],
      ['an action bundle with a file it does not allow', undefined],
    ])('refuses %s', async (name, bundle) => {
      const content = bundle ?? (await bundleOf({...actionFiles(), 'extra.js': 'export {}\n'}));

      const response = await publishAction({content: content as never});

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({code: 'invalid-bundle'});
      expect(name).toBeTruthy();
    });

    it('refuses an action whose main is not index.mjs', async () => {
      const files = actionFiles();
      const content = await bundleOf({
        ...files,
        'action.yml': files['action.yml']?.replace('index.mjs', 'main.mjs') ?? '',
        'main.mjs': 'export {}\n',
      });

      const response = await publishAction({content});

      expect(response.statusCode).toBe(422);
    });

    it('refuses a source archive that carries node_modules', async () => {
      const source = await sourceArchive({'node_modules/left-pad/index.js': 'x'});

      const response = await publishAction({source});

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({code: 'invalid-bundle'});
    });

    it('refuses a content bundle that inflates past its limit', async () => {
      const content = await bundleOf({...actionFiles(), LICENSE: 'a'.repeat(4 * 1024 * 1024)});

      const response = await publishAction({content});

      expect(response.statusCode).toBe(413);
      expect(response.json()).toMatchObject({code: 'too-large'});
    });

    it.each([
      ['a missing part', undefined, (text: string) => text.replace(SOURCE_PART, 'name="other"')],
      ['a part it does not know', {extra: 'x'}, (text: string) => text],
      [
        'a file part without a filename',
        undefined,
        (text: string) => text.replace(CONTENT_FILENAME, ''),
      ],
    ])('refuses a request with %s', async (_name, extraParts, edit) => {
      const {payload, contentType} = await multipartRequest({
        draft: ACTION_DRAFT,
        content: await bundleOf(actionFiles()),
        extraParts,
      });
      // latin1 keeps every byte of the gzip parts through the round trip.
      const body = Buffer.from(edit(payload.toString('latin1')), 'latin1');

      const response = await publisher.app.inject({
        method: 'PUT',
        url: '/v1/packages/shipfox/slack-thread-digest/versions/1.0.0',
        headers: {
          'content-type': contentType,
          authorization: `Bearer ${await publishTokenFor({signingKey})}`,
        },
        payload: body,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({code: 'invalid-request'});
    });

    it('records each refusal of a verified token in the audit table', async () => {
      await publishAction({name: 'github'});

      expect(await auditRows()).toMatchObject([
        {
          event: 'version-publish-refused',
          outcome: 'refused',
          reason: 'reserved-name',
          namespace: 'shipfox',
          package: 'shipfox/github',
          version: '1.0.0',
        },
      ]);
    });
  });

  describe('publish hooks', () => {
    let hookServer: ReturnType<typeof createServer>;
    let received: unknown[];
    let hookStatus: number;
    let hookUrl: string;

    beforeEach(async () => {
      received = [];
      hookStatus = 200;
      hookServer = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          response.writeHead(hookStatus).end();
        });
      });
      await new Promise<void>((resolve) => hookServer.listen(0, '127.0.0.1', resolve));
      hookUrl = `http://127.0.0.1:${(hookServer.address() as AddressInfo).port}/rebuild`;
      await closeApp();
      await start([hookUrl]);
    });

    afterEach(async () => {
      await new Promise((resolve) => hookServer.close(resolve));
    });

    it('calls each hook with the published version', async () => {
      const response = await publishAction();

      expect(response.statusCode).toBe(201);
      expect(received).toEqual([
        {
          package: 'shipfox/slack-thread-digest',
          kind: 'action',
          version: '1.0.0',
          published_at: documentOf(envelopeOf(response)).published_at,
        },
      ]);
    });

    it('publishes when a hook answers with an error', async () => {
      hookStatus = 500;

      const response = await publishAction();

      expect(response.statusCode).toBe(201);
      expect(await storedVersions()).toHaveLength(1);
    });
  });

  it('keeps blobs for versions with identical content in one key', async () => {
    const content = await bundleOf(actionFiles());
    const source = await sourceArchive();

    await publishAction({version: '1.0.0', content, source});
    await publishAction({version: '1.0.1', content, source});

    const rows = await db()
      .select({contentDigest: versions.contentDigest})
      .from(versions)
      .where(and(eq(versions.package, 'shipfox/slack-thread-digest')));
    expect(new Set(rows.map(({contentDigest}) => contentDigest)).size).toBe(1);
  });
});
