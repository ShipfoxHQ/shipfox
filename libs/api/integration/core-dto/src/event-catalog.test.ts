import {z} from 'zod';
import {
  eventPayloadJsonSchema,
  type IntegrationEventCatalog,
  integrationEventCatalogIssues,
} from './event-catalog.js';

const issueFamily = {
  key: 'issue',
  title: 'Issues',
  summary: 'Issue changes.',
  payloadKind: 'shipfox-normalized',
  payloadSchema: eventPayloadJsonSchema(z.object({id: z.string()})),
} as const;

const catalog: IntegrationEventCatalog = {
  provider: 'Example',
  families: [
    issueFamily,
    {key: 'push', title: 'Push', summary: 'Pushes.', payloadKind: 'raw-provider'},
  ],
  events: [
    {name: 'issue.created', family: 'issue', summary: 'An issue is created.'},
    {name: 'push', family: 'push', summary: 'A push.'},
  ],
};

describe('integrationEventCatalogIssues', () => {
  it('accepts a catalog whose events and families agree', () => {
    expect(integrationEventCatalogIssues(catalog)).toEqual([]);
  });

  it('reports undeclared families, empty families, and schema mismatches', () => {
    const issues = integrationEventCatalogIssues({
      ...catalog,
      families: [
        {...issueFamily, payloadSchema: undefined},
        {key: 'comment', title: 'Comments', summary: 'Comments.', payloadKind: 'raw-provider'},
      ],
      events: [...catalog.events, {name: 'x', family: 'missing', summary: 'X.'}],
    });

    expect(issues).toEqual([
      'Family "issue" must carry a payload schema exactly when normalized.',
      'Family "comment" has no events.',
      'Event "push" references the undeclared family "push".',
      'Event "x" references the undeclared family "missing".',
    ]);
  });
});

describe('eventPayloadJsonSchema', () => {
  it('serializes the schema without the JSON Schema dialect marker', () => {
    const schema = eventPayloadJsonSchema(
      z.object({id: z.string().describe('Identifier'), body: z.unknown()}).passthrough(),
    );

    expect(schema).not.toHaveProperty('$schema');
    expect(schema).toMatchObject({
      type: 'object',
      properties: {id: {type: 'string', description: 'Identifier'}},
      required: ['id', 'body'],
    });
  });
});
