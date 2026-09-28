import {REGISTRY_DIGEST_PATTERN} from '#documents.js';
import {canonicalJson, computeFingerprint} from '#fingerprint.js';
import {actionVersionDocument, digest, templateVersionDocument} from '#test/fixtures/documents.js';

describe('computeFingerprint', () => {
  it('is a sha256 digest', async () => {
    const result = await computeFingerprint(actionVersionDocument());

    expect(result).toMatch(REGISTRY_DIGEST_PATTERN);
  });

  it('ignores when and by which run the version was published', async () => {
    const original = actionVersionDocument();
    const retry = {
      ...actionVersionDocument(),
      published_at: '2026-10-13T00:00:00Z',
      fingerprint: digest('0'),
      provenance: {...original.provenance, run_id: '17000000002', run_attempt: '2'},
      builder: {...original.builder, version: '0.2.0'},
    };

    const [first, second] = await Promise.all([
      computeFingerprint(original),
      computeFingerprint(retry),
    ]);

    expect(second).toBe(first);
  });

  it('ignores the key order of the manifest', async () => {
    const original = actionVersionDocument();
    const reordered = {
      ...original,
      manifest: Object.fromEntries(Object.entries(original.manifest).reverse()),
    };

    const [first, second] = await Promise.all([
      computeFingerprint(original),
      computeFingerprint(reordered),
    ]);

    expect(second).toBe(first);
  });

  it.each([
    ['content', {content: {...actionVersionDocument().content, digest: digest('9')}}],
    ['source', {source: {...actionVersionDocument().source, digest: digest('9')}}],
    ['README', {readme: undefined}],
    ['changelog', {changelog: 'Other notes.'}],
    ['manifest', {manifest: {name: 'Other'}}],
    ['dependencies', {dependencies: [{name: 'mdast-util-to-markdown', version: '2.1.3'}]}],
    ['version', {version: '1.4.3'}],
    ['license', {license: 'Apache-2.0'}],
    ['recipe', {builder: {tool: '@shipfox/registry-release', version: '0.1.0', recipe: 2}}],
  ])('changes when the %s changes', async (_field, override) => {
    const original = actionVersionDocument();

    const [first, second] = await Promise.all([
      computeFingerprint(original),
      computeFingerprint({...original, ...override}),
    ]);

    expect(second).not.toBe(first);
  });

  it('ignores the composition format of a template', async () => {
    const template = templateVersionDocument();
    const recomposed = {...template, composition: 2};

    const [first, second] = await Promise.all([
      computeFingerprint(template),
      computeFingerprint(recomposed),
    ]);

    expect(second).toBe(first);
  });

  it('fingerprints a template document', async () => {
    const template = templateVersionDocument();

    const [first, second] = await Promise.all([
      computeFingerprint(template),
      computeFingerprint({...template, actions: []}),
    ]);

    expect(second).not.toBe(first);
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops undefined values', () => {
    const result = canonicalJson({b: 1, a: {d: [{z: 1, y: 2}], c: undefined}});

    expect(result).toBe('{"a":{"d":[{"y":2,"z":1}]},"b":1}');
  });

  it('sorts integer-like keys as text and keeps an own __proto__ key', () => {
    const result = canonicalJson(JSON.parse('{"b":1,"10":1,"2":1,"__proto__":{"x":1}}'));

    expect(result).toBe('{"10":1,"2":1,"__proto__":{"x":1},"b":1}');
  });

  it('writes undefined array items and holes as null', () => {
    // biome-ignore lint/suspicious/noSparseArray: the hole is the case under test.
    const result = canonicalJson([1, undefined, , 2]);

    expect(result).toBe('[1,null,null,2]');
  });

  it('rejects numbers JSON cannot represent', () => {
    expect(() => canonicalJson({size: Number.NaN})).toThrow(TypeError);
  });
});
