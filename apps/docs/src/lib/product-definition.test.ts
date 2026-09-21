import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {getLLMText} from './get-llm-text';
import {buildPageMetadata} from './page-metadata';
import {
  PRODUCT_CATEGORY,
  PRODUCT_DESCRIPTION,
  PRODUCT_HEADLINE,
  PRODUCT_SUBTITLE,
} from './product-definition';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const HOME_DESCRIPTION_PATTERN = /^description: "(.+)"$/m;
const LLMS_PRODUCT_PITCH_PATTERN = /\$\{PRODUCT_SUBTITLE\} \$\{PRODUCT_DESCRIPTION\}/;
type TestPage = Parameters<typeof getLLMText>[0];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

test('keeps crawler-facing docs surfaces on the canonical product positioning', async () => {
  const [homeSource, llmsRoute] = await Promise.all([
    readFile(`${repositoryRoot}/apps/docs/content/docs/index.mdx`, 'utf8'),
    readFile(`${repositoryRoot}/apps/docs/src/app/llms.txt/route.ts`, 'utf8'),
  ]);

  const description = homeSource.match(HOME_DESCRIPTION_PATTERN)?.[1];
  assert.ok(description);
  assert.equal(description, PRODUCT_DESCRIPTION);
  assert.ok(homeSource.includes(`title: "${PRODUCT_HEADLINE}"`));
  assert.ok(homeSource.includes(`**${PRODUCT_SUBTITLE}**`));
  assert.ok(normalizeWhitespace(homeSource).includes(PRODUCT_DESCRIPTION));

  const metadata = buildPageMetadata({
    url: '/',
    data: {title: 'Shipfox', description},
  });
  assert.equal(metadata.description, PRODUCT_DESCRIPTION);
  assert.equal(metadata.openGraph?.description, PRODUCT_DESCRIPTION);

  assert.ok(llmsRoute.includes('PRODUCT_SUBTITLE'));
  assert.ok(llmsRoute.includes('PRODUCT_DESCRIPTION'));
  assert.match(llmsRoute, LLMS_PRODUCT_PITCH_PATTERN);

  const homeMarkdown = await getLLMText({
    url: '/',
    data: {
      title: 'Shipfox',
      description,
      getText: async () => 'Docs home',
    },
  } as unknown as TestPage);
  assert.ok(homeMarkdown.includes(`Description: ${PRODUCT_DESCRIPTION}`));
});

test('records the canonical product pitch in the docs writing guide', async () => {
  const writingGuide = await readFile(`${repositoryRoot}/apps/docs/WRITING.md`, 'utf8');
  const normalizedWritingGuide = normalizeWhitespace(writingGuide.replace(/^> ?/gm, ''));

  assert.ok(writingGuide.includes(`canonical product category is **${PRODUCT_CATEGORY}**`));
  assert.ok(writingGuide.includes(`> ${PRODUCT_HEADLINE}`));
  assert.ok(writingGuide.includes(`> ${PRODUCT_SUBTITLE}`));
  assert.ok(normalizedWritingGuide.includes(PRODUCT_DESCRIPTION));
});
