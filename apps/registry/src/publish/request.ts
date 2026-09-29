import {Buffer} from 'node:buffer';
import {VersionRefusedError} from '#publish/errors.js';

const PARTS = ['draft', 'content', 'source', 'readme'] as const;
type PartName = (typeof PARTS)[number];

export interface PublishRequestParts {
  /** The JSON text of the `draft` part. */
  draft: string;
  content: Buffer;
  source: Buffer;
  readme: Buffer | undefined;
}

/**
 * Splits a multipart publish into its parts. Each of `draft`, `content`, and `source` must appear
 * once, `readme` at most once, and nothing else may appear.
 */
export async function parsePublishRequest({
  body,
  contentType,
}: {
  body: Buffer;
  contentType: string | undefined;
}): Promise<PublishRequestParts> {
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(body), {
      headers: {'content-type': contentType ?? ''},
    }).formData();
  } catch (error) {
    throw new VersionRefusedError(
      'invalid-request',
      'The request body is not valid multipart data',
      {
        cause: error,
      },
    );
  }

  for (const name of new Set(form.keys())) {
    if (!(PARTS as readonly string[]).includes(name)) {
      throw new VersionRefusedError('invalid-request', `Unexpected part ${JSON.stringify(name)}`);
    }
  }
  const [draft, content, source, readme] = await Promise.all(PARTS.map((name) => part(form, name)));
  return {
    draft: required('draft', draft).toString('utf8'),
    content: required('content', content),
    source: required('source', source),
    readme,
  };
}

function required(name: PartName, value: Buffer | undefined): Buffer {
  if (value === undefined)
    throw new VersionRefusedError('invalid-request', `Part ${name} is missing`);
  return value;
}

async function part(form: FormData, name: PartName): Promise<Buffer | undefined> {
  const values = form.getAll(name);
  if (values.length > 1) {
    throw new VersionRefusedError('invalid-request', `Part ${name} appears more than once`);
  }
  const [value] = values;
  if (value === undefined) return undefined;
  return typeof value === 'string'
    ? Buffer.from(value, 'utf8')
    : Buffer.from(await value.arrayBuffer());
}
