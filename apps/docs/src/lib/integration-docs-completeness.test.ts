import assert from 'node:assert/strict';
import test from 'node:test';
import type {CatalogCategory} from '@/lib/integration-catalog';
import {
  collectIntegrationDocIssues,
  type IntegrationDocsCompletenessInput,
} from '@/lib/integration-docs-completeness';
import {registeredIntegrationProviders} from '@/lib/registered-integration-providers';

const githubToolsIssuePattern = /Integration provider "github": add tools\.mdx/;
const sentryCapabilitiesIssuePattern =
  /Integration provider "sentry": remove the stale "agent_tools" capability/;
const cronEventIssuePattern = /Built-in source "cron": mention event "tick"/;
const linearMissingSetupIssuePattern =
  /Integration provider "linear": add setup\.mdx for the connectable provider\./;
const shipfoxUnexpectedSetupIssuePattern =
  /Integration provider "shipfox": remove setup\.mdx because the built-in provider needs no setup\./;
const clickupPrimaryCategoryIssuePattern =
  /Integration provider "clickup": add the primary "issue-tracking" category/;

const validInput: IntegrationDocsCompletenessInput = {
  providers: registeredIntegrationProviders,
  generatedCatalog: {
    github: {
      capabilities: ['source_control', 'events', 'agent_tools'],
      eventCount: 1,
      toolCount: 1,
    },
    sentry: {capabilities: ['events'], eventCount: 1, toolCount: 0},
    webhooks: {capabilities: ['events'], eventCount: 1, toolCount: 0},
    linear: {
      capabilities: ['events', 'agent_tools'],
      eventCount: 17,
      toolCount: 1,
    },
    slack: {
      capabilities: ['events', 'agent_tools'],
      eventCount: 4,
      toolCount: 1,
    },
    jira: {
      capabilities: ['events', 'agent_tools'],
      eventCount: 6,
      toolCount: 11,
    },
    clickup: {
      capabilities: ['events', 'agent_tools'],
      eventCount: 11,
      toolCount: 6,
    },
    shipfox: {capabilities: ['agent_tools'], eventCount: 0, toolCount: 7},
  },
  integrationDirectories: {
    github: directory(
      'github',
      ['index', 'setup', 'events', 'tools'],
      ['index', 'setup', 'events', 'tools'],
      {
        capabilities: ['source_control', 'events', 'agent_tools'],
        categories: ['source-control'],
        aliases: ['git'],
      },
    ),
    sentry: directory('sentry', ['index', 'setup', 'events'], ['index', 'setup', 'events'], {
      capabilities: ['events'],
      categories: ['observability'],
      aliases: ['errors'],
    }),
    webhooks: directory('webhooks', ['index', 'setup', 'events'], ['index', 'setup', 'events'], {
      capabilities: ['events'],
      categories: ['custom'],
      aliases: ['hooks'],
    }),
    linear: directory(
      'linear',
      ['index', 'setup', 'events', 'tools'],
      ['index', 'setup', 'events', 'tools'],
      {
        capabilities: ['events', 'agent_tools'],
        categories: ['issue-tracking'],
        aliases: ['issues'],
      },
    ),
    slack: directory(
      'slack',
      ['index', 'setup', 'events', 'tools'],
      ['index', 'setup', 'events', 'tools'],
      {
        capabilities: ['events', 'agent_tools'],
        categories: ['messaging'],
        aliases: ['chat'],
      },
    ),
    jira: directory(
      'jira',
      ['index', 'setup', 'events', 'tools'],
      ['index', 'setup', 'events', 'tools'],
      {
        capabilities: ['events', 'agent_tools'],
        categories: ['issue-tracking'],
        aliases: ['issues', 'tickets'],
      },
    ),
    clickup: directory(
      'clickup',
      ['index', 'setup', 'events', 'tools'],
      ['index', 'setup', 'events', 'tools'],
      {
        capabilities: ['events', 'agent_tools'],
        categories: ['issue-tracking'],
        aliases: ['tasks', 'project management', 'tickets'],
      },
    ),
    shipfox: directory('shipfox', ['index', 'tools'], ['index', 'tools'], {
      capabilities: ['agent_tools'],
      categories: ['built-in'],
      aliases: ['workflows'],
    }),
  },
  builtInSourceDocs: {cron: 'source: cron\nThe event is `tick`.'},
};

test('accepts complete integration documentation', () => {
  assert.deepEqual(collectIntegrationDocIssues(validInput), []);
});

test('reports provider-named fixes for missing and stale documentation', () => {
  const github = validInput.integrationDirectories.github;
  const sentry = validInput.integrationDirectories.sentry;
  const sentryOverview = catalogOverview(sentry);
  const input: IntegrationDocsCompletenessInput = {
    ...validInput,
    integrationDirectories: {
      ...validInput.integrationDirectories,
      github: {
        ...github,
        pages: ['index', 'setup', 'events'],
        pageBodies: {...github.pageBodies, tools: ''},
      },
      sentry: {
        ...sentry,
        overview: {
          ...sentryOverview,
          catalog: {...sentryOverview.catalog, capabilities: ['events', 'agent_tools']},
        },
      },
    },
    builtInSourceDocs: {cron: 'source: cron'},
  };

  const issues = collectIntegrationDocIssues(input);

  assert.match(issues.join('\n'), githubToolsIssuePattern);
  assert.match(issues.join('\n'), sentryCapabilitiesIssuePattern);
  assert.match(issues.join('\n'), cronEventIssuePattern);
});

test('accepts a guides directory listed after the canonical pages', () => {
  const input: IntegrationDocsCompletenessInput = {
    ...validInput,
    integrationDirectories: {
      ...validInput.integrationDirectories,
      linear: {
        ...directory(
          'linear',
          ['index', 'setup', 'events', 'tools'],
          ['index', 'setup', 'events', 'tools', 'guides'],
          {
            capabilities: ['events', 'agent_tools'],
            categories: ['issue-tracking'],
            aliases: ['issues'],
          },
        ),
        hasGuides: true,
      },
    },
  };

  const issues = collectIntegrationDocIssues(input);

  assert.deepEqual(issues, []);
});

test('reports a missing setup page for a catalog provider', () => {
  const input: IntegrationDocsCompletenessInput = {
    ...validInput,
    integrationDirectories: {
      ...validInput.integrationDirectories,
      linear: directory('linear', ['index', 'events', 'tools'], ['index', 'events', 'tools'], {
        capabilities: ['events', 'agent_tools'],
        categories: ['issue-tracking'],
        aliases: ['issues'],
      }),
    },
  };

  const issues = collectIntegrationDocIssues(input);

  assert.match(issues.join('\n'), linearMissingSetupIssuePattern);
});

test('rejects a setup page for a built-in catalog provider', () => {
  const input: IntegrationDocsCompletenessInput = {
    ...validInput,
    integrationDirectories: {
      ...validInput.integrationDirectories,
      shipfox: directory('shipfox', ['index', 'setup', 'tools'], ['index', 'setup', 'tools'], {
        capabilities: ['agent_tools'],
        categories: ['built-in'],
        aliases: ['workflows'],
      }),
    },
  };

  const issues = collectIntegrationDocIssues(input);

  assert.match(issues.join('\n'), shipfoxUnexpectedSetupIssuePattern);
});

test('reports catalog frontmatter that omits the registered primary category', () => {
  const clickup = validInput.integrationDirectories.clickup;
  const clickupOverview = catalogOverview(clickup);
  const input: IntegrationDocsCompletenessInput = {
    ...validInput,
    integrationDirectories: {
      ...validInput.integrationDirectories,
      clickup: {
        ...clickup,
        overview: {
          ...clickupOverview,
          catalog: {...clickupOverview.catalog, categories: ['custom']},
        },
      },
    },
  };

  const issues = collectIntegrationDocIssues(input);

  assert.match(issues.join('\n'), clickupPrimaryCategoryIssuePattern);
});

test('accepts built-in source documentation without reference-page structure', () => {
  const input: IntegrationDocsCompletenessInput = {
    ...validInput,
    builtInSourceDocs: {
      cron: '# Schedule workflows\nsource: cron # every hour\nThe event is `tick`.',
    },
  };

  assert.deepEqual(collectIntegrationDocIssues(input), []);
});

test('requires an exact built-in source value', () => {
  const input: IntegrationDocsCompletenessInput = {
    ...validInput,
    builtInSourceDocs: {cron: 'source: cronical\nThe event is `tick`.'},
  };

  assert.deepEqual(collectIntegrationDocIssues(input), [
    'Built-in source "cron": show `source: cron` in /how-to/author-workflows/schedule-workflows.',
  ]);
});

test('reports only the built-in-source diagnostic for its integration directory', () => {
  const input: IntegrationDocsCompletenessInput = {
    ...validInput,
    integrationDirectories: {
      ...validInput.integrationDirectories,
      cron: directory('cron', ['index'], ['index'], {
        capabilities: [],
        categories: ['custom'],
        aliases: ['schedule'],
      }),
    },
  };

  const issues = collectIntegrationDocIssues(input);

  assert.deepEqual(
    issues.filter((issue) => issue.includes('integrations/cron')),
    [
      'Built-in source "cron": remove integrations/cron; it is documented at /how-to/author-workflows/schedule-workflows.',
    ],
  );
});

function catalogOverview(directory: (typeof validInput.integrationDirectories)[string]) {
  if (!directory.overview?.catalog) throw new Error('Fixture must include catalog frontmatter.');
  return {
    body: directory.overview.body,
    catalog: directory.overview.catalog,
  };
}

function directory(
  slug: string,
  pages: string[],
  metaPages: string[],
  catalog: {
    capabilities: string[];
    categories: CatalogCategory[];
    aliases: string[];
  },
) {
  return {
    pages,
    metaPages,
    pageBodies: {
      index: 'Integration overview.',
      setup: 'Set up the integration.',
      events: `generated/integrations/${slug}/events.mdx`,
      tools: `generated/integrations/${slug}/tools.mdx`,
    },
    overview: {catalog, body: 'Integration overview.'},
  };
}
