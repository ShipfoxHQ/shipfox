import {startNotionApiMock} from '@shipfox/e2e-driver-notion';
import {
  type ContractFakeAdapter,
  ephemeralEndpoint,
  field,
  fixtureComments,
  rejectingSeed,
  requiredField,
} from './shared.js';

/** What the Notion tool adapter needs to act as the connection. */
export interface NotionContractAccess {
  accessToken: string;
}

// What the sandbox's Notion pages are, among its fixtures. A fixture with an `id` and a `title`
// that is not listed here is not a page.
const NOTION_PAGE_FIXTURES = ['page', 'write_parent_page'] as const;

/**
 * Notion, behind an access token the fake answers for. It seeds the page fixtures as pages, and the
 * `page` fixture gets its `comment_count` comments. The `data_source` fixture becomes a data
 * source of `row_count` rows, so a query has a second page.
 */
export const notionContractFake: ContractFakeAdapter<NotionContractAccess> = async ({
  uniqueId,
  cleanups,
}) => {
  const accessToken = `notion-access-token-${uniqueId}`;
  const mock = await startNotionApiMock({
    accessToken,
    rejectUnseeded: true,
    endpoint: ephemeralEndpoint(),
  });
  cleanups.push(() => mock.stop());

  return {
    env: {NOTION_API_BASE_URL: mock.endpoint.toString()},
    access: {accessToken},
    seed: (fixtures) =>
      rejectingSeed(() => {
        for (const fixtureName of NOTION_PAGE_FIXTURES) {
          const fixture = fixtures[fixtureName];
          if (fixture === undefined) continue;
          const id = String(requiredField({provider: 'notion', fixture, fixtureName, name: 'id'}));
          const title = String(
            requiredField({provider: 'notion', fixture, fixtureName, name: 'title'}),
          );
          mock.pages.set(id, {
            id,
            title,
            markdown: String(field({fixture, name: 'markdown'}) ?? `# ${title}\n`),
            comments: fixtureComments(fixture),
          });
        }
        const dataSource = fixtures.data_source;
        if (dataSource === undefined) return;
        const id = String(
          requiredField({
            provider: 'notion',
            fixture: dataSource,
            fixtureName: 'data_source',
            name: 'id',
          }),
        );
        const rowCount = Number(field({fixture: dataSource, name: 'row_count'}) ?? 0);
        mock.dataSources.set(id, {
          id,
          rows: Array.from({length: rowCount}, (_, index) => ({
            id: `contract-row-${index + 1}`,
            title: `Contract row ${index + 1}`,
          })),
        });
      }),
    writes: () => mock.writes(),
  };
};
