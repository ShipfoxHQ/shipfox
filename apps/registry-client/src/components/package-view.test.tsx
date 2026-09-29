import {renderToStaticMarkup} from 'react-dom/server';
import {
  actionDocument,
  catalogEntry,
  envelope,
  templateDocument,
} from '#test/fixtures/documents.js';
import {startFixtureApi} from '#test/fixtures/registry-api.js';
import {loadPackagePage} from '@/lib/package-page';
import {RegistryApi} from '@/lib/registry-api';
import {PackageView} from './package-view';

const PROFILE = {namespace: 'shipfox', display_name: 'Shipfox', verified: true};

const README = [
  '# Task to pull request',
  '',
  'Read the [workflow docs](https://www.shipfox.io/docs) or [the guide](./GUIDE.md).',
  '',
  '<script>alert(1)</script>',
  '',
  '![diagram](https://example.com/diagram.png)',
  '',
  '| Step | Result |',
  '| --- | --- |',
  '| Tests | Pass |',
].join('\n');

async function renderPackage(routes: Parameters<typeof startFixtureApi>[0], name: string) {
  const api = await startFixtureApi(routes);
  try {
    const page = await loadPackagePage({api: new RegistryApi(api.url), namespace: 'shipfox', name});
    return {
      page,
      html: page ? renderToStaticMarkup(<PackageView page={page} />) : '',
      requests: api.requests,
    };
  } finally {
    await api.close();
  }
}

describe('package page', () => {
  describe('a template with a README and changelogs', () => {
    const routes = {
      '/v1/packages/shipfox/ticket-to-pr': {
        body: {
          package: 'shipfox/ticket-to-pr',
          kind: 'template',
          versions: [
            {
              version: '1.0.0',
              digest: `sha256:${'d'.repeat(64)}`,
              published_at: '2026-10-01T09:00:00.000Z',
              capability_change: false,
            },
            {
              version: '1.1.0',
              digest: `sha256:${'d'.repeat(64)}`,
              published_at: '2026-10-05T09:00:00.000Z',
              bump: 'minor',
              capability_change: false,
            },
          ],
        },
      },
      '/v1/namespaces/shipfox': {body: PROFILE},
      '/v1/packages/shipfox/ticket-to-pr/versions/1.0.0': {
        body: envelope(
          templateDocument({version: '1.0.0', publishedAt: '2026-10-01T09:00:00.000Z'}),
        ),
      },
      '/v1/packages/shipfox/ticket-to-pr/versions/1.1.0': {
        body: envelope(
          templateDocument({
            version: '1.1.0',
            publishedAt: '2026-10-05T09:00:00.000Z',
            changelog: '- Adds the feedback loop.',
            readme: true,
          }),
        ),
      },
      '/v1/packages/shipfox/ticket-to-pr/versions/1.1.0/readme': {body: README},
      '/v1/packages': {
        body: {
          packages: [
            catalogEntry({package: 'shipfox/fix-dependency-ci', title: 'Fix dependency CI'}),
          ],
        },
      },
    };

    it('shows the latest version and every version, newest first, with its changelog', async () => {
      const {page, html} = await renderPackage(routes, 'ticket-to-pr');

      expect(page?.version).toBe('1.1.0');
      expect(page?.versions.map((version) => version.version)).toEqual(['1.1.0', '1.0.0']);
      expect(html).toContain('Adds the feedback loop.');
      expect(html).toContain('Minor release');
    });

    it('renders the structured template fields', async () => {
      const {html} = await renderPackage(routes, 'ticket-to-pr');

      expect(html).toContain('Task to pull request');
      expect(html).toContain('The agent changes the code');
      expect(html).toContain('the workflow goes back to “The agent changes the code”');
      expect(html).toContain('Pushes a branch and opens a pull request.');
      expect(html).toContain('<code');
      expect(html).toContain('Should the agent answer review comments?');
      expect(html).toContain('test_command');
      expect(html).toContain('shipfox/slack-thread-digest@1.0.0');
      expect(html).toContain(
        'https://github.com/ShipfoxHQ/shipfox/tree/3066dabaa0000000000000000000000000000000/libs/shared/workflow/catalog/templates/ticket-to-pr',
      );
    });

    it('lists only the choices the agent asks, with their defaults and tradeoffs', async () => {
      const {html} = await renderPackage(routes, 'ticket-to-pr');

      expect(html).not.toContain('Which source?');
      expect(html).toContain('Do you track tasks in a tracker?');
      expect(html).toContain(
        'As a draft<span class="text-foreground-neutral-muted"> (default)</span>',
      );
      expect(html).toContain('A draft waits for your review.');
      expect(html).toContain('Reviewers are notified at once.');
    });

    it('shows the adopt prompt with the first-party template id', async () => {
      const {html} = await renderPackage(routes, 'ticket-to-pr');

      expect(html).toContain(
        'Use Shipfox to create a workflow from the ticket-to-pr template, without the tracker part.',
      );
    });

    it('links only the related packages the registry knows', async () => {
      const {page} = await renderPackage(routes, 'ticket-to-pr');

      expect(page?.related).toEqual([
        {package: 'shipfox/fix-dependency-ci', title: 'Fix dependency CI'},
      ]);
    });

    it('renders the README without raw HTML or images, and marks links as user content', async () => {
      const {html} = await renderPackage(routes, 'ticket-to-pr');

      expect(html).toContain('<a href="https://www.shipfox.io/docs" rel="nofollow ugc noopener"');
      expect(html).not.toContain('href="./GUIDE.md"');
      expect(html).toContain('the guide');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<img');
      expect(html).toContain('<table');
    });
  });

  describe('an action without a README or changelog', () => {
    const routes = {
      '/v1/packages/shipfox/slack-thread-digest': {
        body: {
          package: 'shipfox/slack-thread-digest',
          kind: 'action',
          versions: [
            {
              version: '1.0.0',
              digest: `sha256:${'a'.repeat(64)}`,
              published_at: '2026-10-12T09:14:03.000Z',
              capability_change: false,
            },
          ],
        },
      },
      '/v1/namespaces/shipfox': {body: PROFILE},
      '/v1/packages/shipfox/slack-thread-digest/versions/1.0.0': {
        body: envelope(actionDocument({version: '1.0.0'})),
      },
    };

    it('renders from the structured fields alone', async () => {
      const {html, requests} = await renderPackage(routes, 'slack-thread-digest');

      expect(html).toContain('Slack thread digest');
      expect(html).not.toContain('Overview');
      expect(html).toContain('Read-only. It cannot call tools that change data.');
      expect(html).toContain('channel_id');
      expect(html).toContain('uses: shipfox/slack-thread-digest@1.0.0');
      expect(html).toContain('mdast-util-to-markdown');
      expect(requests.some((path) => path.endsWith('/readme'))).toBe(false);
    });
  });

  it('is undefined for a package the registry does not know', async () => {
    const {page} = await renderPackage({}, 'missing');

    expect(page).toBeUndefined();
  });

  it('is undefined for a name that is not a package name, without asking the registry', async () => {
    const {page, requests} = await renderPackage({}, 'Not_A_Slug');

    expect(page).toBeUndefined();
    expect(requests).toEqual([]);
  });
});
