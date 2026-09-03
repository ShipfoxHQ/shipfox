import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {getLLMText} from './get-llm-text';
import {buildPageMetadata} from './page-metadata';
import {
  PRODUCT_CATEGORY,
  PRODUCT_DEFINITION,
  PRODUCT_HEADLINE,
  PRODUCT_SUPPORTING_COPY,
  PRODUCT_TAGLINE,
} from './product-definition';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const FIRST_SENTENCE_PATTERN = /^.*?\.(?:\s|$)/;
const HOME_DESCRIPTION_PATTERN = /^description: "(.+)"$/m;
const LLMS_PRODUCT_PITCH_PATTERN =
  /\$\{PRODUCT_DEFINITION\} \$\{PRODUCT_TAGLINE\} \$\{PRODUCT_SUPPORTING_COPY\}/;
type TestPage = Parameters<typeof getLLMText>[0];

function firstSentence(value: string): string {
  const sentence = value.match(FIRST_SENTENCE_PATTERN)?.[0].trim();
  assert.ok(sentence, `Expected a complete first sentence in: ${value}`);
  return sentence;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

test('keeps crawler-facing docs surfaces on the canonical product definition', async () => {
  const [homeSource, llmsRoute] = await Promise.all([
    readFile(`${repositoryRoot}/apps/docs/content/docs/index.mdx`, 'utf8'),
    readFile(`${repositoryRoot}/apps/docs/src/app/llms.txt/route.ts`, 'utf8'),
  ]);

  const description = homeSource.match(HOME_DESCRIPTION_PATTERN)?.[1];
  assert.ok(description);
  assert.equal(firstSentence(description), PRODUCT_DEFINITION);
  assert.ok(homeSource.includes(`## ${PRODUCT_HEADLINE}`));
  assert.ok(homeSource.includes(`**${PRODUCT_TAGLINE}**`));
  assert.ok(normalizeWhitespace(homeSource).includes(PRODUCT_SUPPORTING_COPY));

  const metadata = buildPageMetadata({
    url: '/',
    data: {title: 'Shipfox', description},
  });
  assert.equal(firstSentence(String(metadata.description)), PRODUCT_DEFINITION);
  assert.equal(firstSentence(String(metadata.openGraph?.description)), PRODUCT_DEFINITION);

  assert.ok(llmsRoute.includes('PRODUCT_DEFINITION,'));
  assert.ok(llmsRoute.includes('PRODUCT_TAGLINE,'));
  assert.ok(llmsRoute.includes('PRODUCT_SUPPORTING_COPY,'));
  assert.match(llmsRoute, LLMS_PRODUCT_PITCH_PATTERN);
  assert.ok(!llmsRoute.includes('trigger pipelines'));

  const homeMarkdown = await getLLMText({
    url: '/',
    data: {
      title: 'Shipfox',
      description,
      getText: async () => 'Docs home',
    },
  } as unknown as TestPage);
  assert.ok(homeMarkdown.includes(`Description: ${PRODUCT_DEFINITION}`));
});

test('records the canonical product pitch in the docs writing guide', async () => {
  const writingGuide = await readFile(`${repositoryRoot}/apps/docs/WRITING.md`, 'utf8');

  assert.ok(writingGuide.includes(`canonical product category is **${PRODUCT_CATEGORY}**`));
  assert.ok(writingGuide.includes(`> ${PRODUCT_DEFINITION}`));
  assert.ok(writingGuide.includes(`> ${PRODUCT_HEADLINE}`));
  assert.ok(writingGuide.includes(`> ${PRODUCT_TAGLINE}`));
  assert.ok(writingGuide.includes(`> ${PRODUCT_SUPPORTING_COPY}`));
});
