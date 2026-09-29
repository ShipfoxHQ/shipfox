import {renderToStaticMarkup} from 'react-dom/server';
import {catalogEntry} from '#test/fixtures/documents.js';
import {catalogFilters} from '@/lib/catalog';
import {CatalogView} from './catalog-view';

describe('catalogFilters', () => {
  it('keeps a known kind and a trimmed search', () => {
    const filters = catalogFilters({kind: 'action', q: '  slack  '});

    expect(filters).toEqual({kind: 'action', query: 'slack'});
  });

  it('ignores an unknown kind and an empty search', () => {
    const filters = catalogFilters({kind: 'skill', q: ' '});

    expect(filters).toEqual({});
  });
});

describe('CatalogView', () => {
  it('keeps the order the registry returns', () => {
    const packages = [
      catalogEntry({package: 'shipfox/ticket-to-pr', title: 'Task to pull request'}),
      catalogEntry({
        package: 'shipfox/slack-thread-digest',
        title: 'Slack thread digest',
        kind: 'action',
        integrations: ['slack'],
      }),
    ];

    const html = renderToStaticMarkup(<CatalogView packages={packages} filters={{}} />);

    expect(html.indexOf('Task to pull request')).toBeLessThan(html.indexOf('Slack thread digest'));
    expect(html).toContain('href="/shipfox/slack-thread-digest"');
    expect(html).toContain('shipfox/slack-thread-digest@1.0.0');
    expect(html).toContain('2 packages');
  });

  it('offers to clear the search when nothing matches', () => {
    const html = renderToStaticMarkup(
      <CatalogView packages={[]} filters={{kind: 'action', query: 'nothing'}} />,
    );

    expect(html).toContain('No packages match');
    expect(html).toContain('value="nothing"');
    expect(html).toContain('name="kind" value="action"');
  });
});
