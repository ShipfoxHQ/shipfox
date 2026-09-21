import type {
  AgentToolCatalogEntry,
  AgentToolJsonSchema,
  AgentToolSelectionCatalog,
  AgentToolSelector,
} from '@shipfox/api-integration-spi';

export type PosthogAgentToolRequiredScope = 'read';

const posthogAgentToolSchemas = {
  'execute-sql': {
    properties: {
      connectionId: {
        description:
          "Optional id of a data warehouse connection (e.g. Postgres, MySQL, Snowflake, Redshift). When set, the query runs live against that source instead of the ClickHouse catalog, and may only reference that source's tables. Discover connection ids with external-data-sources-connections-list, then list a connection's tables by running `SELECT table_name FROM system.information_schema.tables` with that connectionId set.",
        type: 'string',
      },
      query: {
        description: 'The final SQL query to be executed.',
        minLength: 1,
        type: 'string',
      },
      sendRawQuery: {
        description:
          "Send `query` to the connection verbatim instead of compiling it from HogQL first. Use this for SQL only that connection's own engine understands, such as vendor-specific functions. Requires connectionId, and works only on a pure direct connection (access_method 'direct'), not on a synced source with live queries enabled. The connection is read-only and accepts a single statement.",
        type: 'boolean',
      },
      truncate: {
        default: true,
        description:
          'Whether to truncate large blob/JSON values in results. Defaults to true. Set to false when you need full untruncated results (e.g., for dumping to a file).',
        type: 'boolean',
      },
    },
    required: ['query'],
    type: 'object',
  },
  'read-data-schema': {
    properties: {
      query: {
        description: 'The data schema query to execute.',
        oneOf: [
          {
            additionalProperties: false,
            properties: {
              kind: {
                const: 'events',
                type: 'string',
              },
              limit: {
                default: 500,
                description: 'Number of events to return per page.',
                maximum: 500,
                minimum: 1,
                type: 'integer',
              },
              offset: {
                default: 0,
                description: 'Number of events to skip for pagination.',
                maximum: 9007199254740991,
                minimum: 0,
                type: 'integer',
              },
            },
            required: ['kind'],
            type: 'object',
          },
          {
            additionalProperties: false,
            properties: {
              event_name: {
                description: 'The name of the event that you want to retrieve properties for.',
                type: 'string',
              },
              kind: {
                const: 'event_properties',
                type: 'string',
              },
            },
            required: ['kind', 'event_name'],
            type: 'object',
          },
          {
            additionalProperties: false,
            properties: {
              entity: {
                description:
                  'The entity to read: `person`, `session` for the columns of the `sessions` table, or a group type name. The plural form of any of these is accepted too.',
                type: 'string',
              },
              kind: {
                const: 'entity_properties',
                type: 'string',
              },
            },
            required: ['kind', 'entity'],
            type: 'object',
          },
          {
            additionalProperties: false,
            properties: {
              action_id: {
                description: 'The ID of the action that you want to retrieve properties for.',
                maximum: 9007199254740991,
                minimum: -9007199254740991,
                type: 'integer',
              },
              kind: {
                const: 'action_properties',
                type: 'string',
              },
            },
            required: ['kind', 'action_id'],
            type: 'object',
          },
          {
            additionalProperties: false,
            properties: {
              entity: {
                description:
                  'The entity to read: `person`, `session` for the columns of the `sessions` table, or a group type name. The plural form of any of these is accepted too.',
                type: 'string',
              },
              kind: {
                const: 'entity_property_values',
                type: 'string',
              },
              property_name: {
                description: 'Verified property name of an entity.',
                type: 'string',
              },
            },
            required: ['kind', 'entity', 'property_name'],
            type: 'object',
          },
          {
            additionalProperties: false,
            properties: {
              event_name: {
                description: 'Verified event name',
                type: 'string',
              },
              kind: {
                const: 'event_property_values',
                type: 'string',
              },
              property_name: {
                description: 'Verified property name of an event.',
                type: 'string',
              },
            },
            required: ['kind', 'event_name', 'property_name'],
            type: 'object',
          },
          {
            additionalProperties: false,
            properties: {
              action_id: {
                description: 'Verified action ID',
                maximum: 9007199254740991,
                minimum: -9007199254740991,
                type: 'integer',
              },
              kind: {
                const: 'action_property_values',
                type: 'string',
              },
              property_name: {
                description: 'Verified property name of an action.',
                type: 'string',
              },
            },
            required: ['kind', 'action_id', 'property_name'],
            type: 'object',
          },
        ],
      },
    },
    required: ['query'],
    type: 'object',
  },
  'insights-list': {
    properties: {
      created_by: {
        description:
          'JSON-encoded array of user IDs. Only returns insights whose `created_by` is in the list, e.g. `[1,42]`.',
        type: 'string',
      },
      created_date_from: {
        description:
          'Filter by `created_at > created_date_from`. Accepts absolute or relative dates.',
        type: 'string',
      },
      created_date_to: {
        description:
          'Filter by `created_at < created_date_to`. Accepts absolute or relative dates.',
        type: 'string',
      },
      dashboards: {
        description:
          'JSON-encoded array of dashboard IDs. Returns insights attached to every listed dashboard (AND).',
        type: 'string',
      },
      date_from: {
        description:
          'Filter by `last_modified_at > date_from`. Accepts absolute dates (`2025-04-23`) or relative strings (`-7d`, `-1m`).',
        type: 'string',
      },
      date_to: {
        description:
          'Filter by `last_modified_at < date_to`. Accepts absolute dates or relative strings.',
        type: 'string',
      },
      favorited: {
        description:
          'Include this parameter (any value) to restrict results to insights marked as favorited.',
        type: 'boolean',
      },
      include_dashboards: {
        description:
          'Opt in to receiving the deprecated `dashboards` field in insight payloads. Once opt-in enforcement is enabled, API-token callers stop receiving it by default; use `dashboard_tiles` instead.',
        type: 'boolean',
      },
      insight: {
        description:
          'Restrict to a single insight type. `JSON` matches non-wrapper query insights; `SQL` matches HogQL queries.',
        enum: [
          'FUNNELS',
          'JOURNEYS',
          'JSON',
          'LIFECYCLE',
          'PATHS',
          'RETENTION',
          'SQL',
          'STICKINESS',
          'TRENDS',
        ],
        type: 'string',
      },
      last_viewed_date_from: {
        description:
          'Filter by `last_viewed_at > last_viewed_date_from`. Accepts absolute or relative dates.',
        type: 'string',
      },
      last_viewed_date_to: {
        description:
          'Filter by `last_viewed_at < last_viewed_date_to`. Accepts absolute or relative dates.',
        type: 'string',
      },
      limit: {
        description: 'Number of results to return per page.',
        type: 'number',
      },
      offset: {
        description: 'The initial index from which to return the results.',
        type: 'number',
      },
      saved: {
        description:
          'When truthy, restricts results to insights that are saved (or attached to a visible dashboard). When falsy, only unsaved insights.',
        type: 'boolean',
      },
      search: {
        description:
          "Search term matched across name, derived_name, description, and tag names. Returns exact (case-insensitive substring) matches only; if no exact match exists, returns similar (fuzzy trigram) matches instead. Each result's `search_match_type` is `exact` or `similar`.",
        type: 'string',
      },
      short_id: {
        type: 'string',
      },
      tags: {
        description:
          'JSON-encoded array of tag names. Returns insights with any of the listed tags.',
        type: 'string',
      },
      user: {
        description:
          'Include this parameter (any value) to restrict results to insights created by the authenticated user.',
        type: 'boolean',
      },
    },
    type: 'object',
  },
  'insight-get': {
    properties: {
      filters_override: {
        anyOf: [
          {
            type: 'string',
          },
          {
            additionalProperties: {},
            propertyNames: {
              type: 'string',
            },
            type: 'object',
          },
        ],
        description:
          "Object (or pre-encoded JSON string) to override the insight's filters for this request only (not persisted). Top-level keys replace; nested values are not deep-merged — pass the complete value for any key you override. Accepts the same keys as the dashboard filters schema (e.g., `date_from`, `date_to`, `properties`). Ignored when accessed via a sharing token.",
      },
      id: {
        anyOf: [
          {
            type: 'number',
          },
          {
            type: 'string',
          },
        ],
        description:
          'Numeric primary key or 8-character `short_id` (for example `AaVQ8Ijw`) identifying the insight.',
      },
      include_dashboards: {
        description:
          'Opt in to receiving the deprecated `dashboards` field in insight payloads. Once opt-in enforcement is enabled, API-token callers stop receiving it by default; use `dashboard_tiles` instead.',
        type: 'boolean',
      },
      variables_override: {
        anyOf: [
          {
            type: 'string',
          },
          {
            additionalProperties: {},
            propertyNames: {
              type: 'string',
            },
            type: 'object',
          },
        ],
        description:
          'Object (or pre-encoded JSON string) to override the insight\'s HogQL variables for this request only (not persisted). Format: {"<variable_id>": {"code_name": "<code_name>", "variableId": "<variable_id>", "value": <new_value>}}. Each entry must include `code_name` — partial entries are silently dropped. The simplest workflow is to call `insight-get` first, copy the matching entry from the response, and mutate `value`. Top-level keys replace; nested values are not deep-merged. Ignored when accessed via a sharing token.',
      },
    },
    required: ['id'],
    type: 'object',
  },
  'insight-query': {
    properties: {
      filters_override: {
        anyOf: [
          {
            type: 'string',
          },
          {
            additionalProperties: {},
            propertyNames: {
              type: 'string',
            },
            type: 'object',
          },
        ],
        description:
          "Object (or pre-encoded JSON string) to override the insight's filters for this run only (not persisted). Top-level keys replace; nested values are not deep-merged — pass the complete value for any key you override. Accepts the same keys as the dashboard filters schema (e.g., `date_from`, `date_to`, `properties`). Ignored when accessed via a sharing token.",
      },
      insightId: {
        anyOf: [
          {
            type: 'string',
          },
          {
            type: 'number',
          },
        ],
        description: 'The insight to run: its numeric `id` or 8-character `short_id`.',
      },
      output_format: {
        default: 'optimized',
        description:
          'Output format. "optimized" returns a human-readable summary from server-side formatters (recommended for analysis). "json" returns the raw query results as JSON.',
        enum: ['optimized', 'json'],
        type: 'string',
      },
      variables_override: {
        anyOf: [
          {
            type: 'string',
          },
          {
            additionalProperties: {},
            propertyNames: {
              type: 'string',
            },
            type: 'object',
          },
        ],
        description:
          'Object (or pre-encoded JSON string) to override the insight\'s HogQL variables for this run only (not persisted). Format: {"<variable_id>": {"code_name": "<code_name>", "variableId": "<variable_id>", "value": <new_value>}}. Each entry must include `code_name` — partial entries are silently dropped. The simplest workflow is to call `insight-get` first, copy the matching entry from the response\'s query variables, and mutate `value`. Top-level keys replace; nested values are not deep-merged. Ignored when accessed via a sharing token.',
      },
    },
    required: ['insightId'],
    type: 'object',
  },
  'dashboards-get-all': {
    properties: {
      exclude_generated: {
        description: 'Optional. Exclude dashboards that PostHog generated.',
        type: 'boolean',
      },
      folder: {
        description:
          "Optional. Return only dashboards filed directly in this project-tree folder, e.g. 'Unfiled/Dashboards'. An empty string matches dashboards at the project root. Nested sub-folders are not included.",
        type: 'string',
      },
      limit: {
        description: 'Number of results to return per page.',
        type: 'number',
      },
      offset: {
        description: 'The initial index from which to return the results.',
        type: 'number',
      },
      pinned: {
        description: 'Optional. Return only pinned dashboards.',
        type: 'boolean',
      },
      search: {
        description:
          "Optional. Match against dashboard `name`, `description`, and tag names. Returns exact (case-insensitive substring) matches only; if no exact match exists, returns similar (fuzzy trigram — typos, transpositions, prefix-as-you-type) matches instead. Results are then ordered by relevance, then pinned status, then name; each result's `search_match_type` is `exact` or `similar`. When omitted, dashboards are ordered by pinned status then alphabetical name. Capped at 200 characters; longer queries return a 400 error.",
        type: 'string',
      },
    },
    type: 'object',
  },
  'dashboard-get': {
    properties: {
      filters_override: {
        anyOf: [
          {
            type: 'string',
          },
          {
            additionalProperties: {},
            propertyNames: {
              type: 'string',
            },
            type: 'object',
          },
        ],
        description:
          'Object (or pre-encoded JSON string) to override dashboard filters for this request only (not persisted). Top-level keys replace; nested values are not deep-merged — pass the complete value for any key you override. Accepts the same keys as the dashboard filters schema (e.g., `date_from`, `date_to`, `properties`). Ignored when accessed via a sharing token.',
      },
      id: {
        description: 'A unique integer value identifying this dashboard.',
        type: 'number',
      },
      include_dashboards: {
        description:
          'Opt in to receiving the deprecated `dashboards` field in insight payloads. Once opt-in enforcement is enabled, API-token callers stop receiving it by default; use `dashboard_tiles` instead.',
        type: 'boolean',
      },
      variables_override: {
        anyOf: [
          {
            type: 'string',
          },
          {
            additionalProperties: {},
            propertyNames: {
              type: 'string',
            },
            type: 'object',
          },
        ],
        description:
          'Object (or pre-encoded JSON string) to override dashboard variables for this request only (not persisted). Format: {"<variable_id>": {"code_name": "<code_name>", "variableId": "<variable_id>", "value": <new_value>}}. Each entry must include `code_name` — partial entries are silently dropped. The simplest workflow is to call `dashboard-get` first, copy the matching entry from the response, and mutate `value`. Top-level keys replace; nested values are not deep-merged. Ignored when accessed via a sharing token.',
      },
    },
    required: ['id'],
    type: 'object',
  },
  'dashboard-insights-run': {
    properties: {
      filters_override: {
        anyOf: [
          {
            type: 'string',
          },
          {
            additionalProperties: {},
            propertyNames: {
              type: 'string',
            },
            type: 'object',
          },
        ],
        description:
          'Object (or pre-encoded JSON string) to override dashboard filters for this request only (not persisted). Top-level keys replace; nested values are not deep-merged — pass the complete value for any key you override. Accepts the same keys as the dashboard filters schema (e.g., `date_from`, `date_to`, `properties`). Ignored when accessed via a sharing token.',
      },
      id: {
        description: 'A unique integer value identifying this dashboard.',
        type: 'number',
      },
      output_format: {
        description:
          "'optimized' (default) returns LLM-friendly formatted text per insight. 'json' returns the raw query result objects.",
        enum: ['json', 'optimized'],
        type: 'string',
      },
      refresh: {
        description:
          "Cache behavior. 'force_cache' (default) serves from cache even if stale. 'blocking' uses cache if fresh, otherwise recalculates. 'force_blocking' always recalculates.",
        enum: ['blocking', 'force_blocking', 'force_cache'],
        type: 'string',
      },
      variables_override: {
        anyOf: [
          {
            type: 'string',
          },
          {
            additionalProperties: {},
            propertyNames: {
              type: 'string',
            },
            type: 'object',
          },
        ],
        description:
          'Object (or pre-encoded JSON string) to override dashboard variables for this request only (not persisted). Format: {"<variable_id>": {"code_name": "<code_name>", "variableId": "<variable_id>", "value": <new_value>}}. Each entry must include `code_name` — partial entries are silently dropped. The simplest workflow is to call `dashboard-get` first, copy the matching entry from the response, and mutate `value`. Top-level keys replace; nested values are not deep-merged. Ignored when accessed via a sharing token.',
      },
    },
    required: ['id'],
    type: 'object',
  },
  'query-error-tracking-issues-list': {
    properties: {
      assignee: {
        anyOf: [
          {
            properties: {
              id: {
                anyOf: [
                  {
                    type: 'string',
                  },
                  {
                    type: 'number',
                  },
                ],
                description: 'User ID or role UUID to filter by.',
              },
              type: {
                description:
                  'Assignee target type: user or role.\n\n* `user` - user\n* `role` - role',
                enum: ['user', 'role'],
                type: 'string',
              },
            },
            required: ['id', 'type'],
            type: 'object',
          },
          {
            type: 'null',
          },
        ],
        description: 'Filter by issue assignee. Omit to include all assignees.',
      },
      dateRange: {
        description: 'Date range for issue aggregates. Defaults to the last 7 days.',
        properties: {
          date_from: {
            description:
              'Start of the date range as an ISO timestamp or relative date such as -7d. Defaults to -7d.',
            type: 'string',
          },
          date_to: {
            anyOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
            description:
              'End of the date range as an ISO timestamp or relative date. Defaults to now when omitted.',
          },
        },
        type: 'object',
      },
      filePath: {
        description: 'Search stack-frame source/file path text.',
        maxLength: 1000,
        type: 'string',
      },
      filterGroup: {
        description:
          'Advanced flat AND property filters. Prefer typed shortcut fields when they fit. HogQL filters are rejected.',
        items: {
          properties: {
            key: {
              description:
                "Key of the property you're filtering on. For example `email` or `$current_url`",
              type: 'string',
            },
            operator: {
              anyOf: [
                {
                  description:
                    '* `exact` - exact\n* `is_not` - is_not\n* `icontains` - icontains\n* `not_icontains` - not_icontains\n* `starts_with` - starts_with\n* `not_starts_with` - not_starts_with\n* `ends_with` - ends_with\n* `not_ends_with` - not_ends_with\n* `regex` - regex\n* `not_regex` - not_regex\n* `gt` - gt\n* `lt` - lt\n* `gte` - gte\n* `lte` - lte\n* `is_set` - is_set\n* `is_not_set` - is_not_set\n* `is_date_exact` - is_date_exact\n* `is_date_after` - is_date_after\n* `is_date_before` - is_date_before\n* `in` - in\n* `not_in` - not_in',
                  enum: [
                    'exact',
                    'is_not',
                    'icontains',
                    'not_icontains',
                    'starts_with',
                    'not_starts_with',
                    'ends_with',
                    'not_ends_with',
                    'regex',
                    'not_regex',
                    'gt',
                    'lt',
                    'gte',
                    'lte',
                    'is_set',
                    'is_not_set',
                    'is_date_exact',
                    'is_date_after',
                    'is_date_before',
                    'in',
                    'not_in',
                  ],
                  type: 'string',
                },
                {
                  enum: [''],
                  type: 'string',
                },
                {
                  type: 'null',
                },
              ],
              default: 'exact',
            },
            type: {
              anyOf: [
                {
                  description:
                    '* `event` - event\n* `event_metadata` - event_metadata\n* `feature` - feature\n* `person` - person\n* `person_metadata` - person_metadata\n* `cohort` - cohort\n* `element` - element\n* `static-cohort` - static-cohort\n* `dynamic-cohort` - dynamic-cohort\n* `precalculated-cohort` - precalculated-cohort\n* `group` - group\n* `recording` - recording\n* `log_entry` - log_entry\n* `behavioral` - behavioral\n* `session` - session\n* `hogql` - hogql\n* `data_warehouse` - data_warehouse\n* `data_warehouse_person_property` - data_warehouse_person_property\n* `error_tracking_issue` - error_tracking_issue\n* `log` - log\n* `log_attribute` - log_attribute\n* `log_resource_attribute` - log_resource_attribute\n* `metric_attribute` - metric_attribute\n* `span` - span\n* `span_attribute` - span_attribute\n* `span_resource_attribute` - span_resource_attribute\n* `revenue_analytics` - revenue_analytics\n* `account_custom_property` - account_custom_property\n* `flag` - flag\n* `workflow_variable` - workflow_variable',
                  enum: [
                    'event',
                    'event_metadata',
                    'feature',
                    'person',
                    'person_metadata',
                    'cohort',
                    'element',
                    'static-cohort',
                    'dynamic-cohort',
                    'precalculated-cohort',
                    'group',
                    'recording',
                    'log_entry',
                    'behavioral',
                    'session',
                    'hogql',
                    'data_warehouse',
                    'data_warehouse_person_property',
                    'error_tracking_issue',
                    'log',
                    'log_attribute',
                    'log_resource_attribute',
                    'metric_attribute',
                    'span',
                    'span_attribute',
                    'span_resource_attribute',
                    'revenue_analytics',
                    'account_custom_property',
                    'flag',
                    'workflow_variable',
                  ],
                  type: 'string',
                },
                {
                  enum: [''],
                  type: 'string',
                },
              ],
              default: 'event',
            },
            value: {
              anyOf: [
                {
                  type: 'string',
                },
                {
                  type: 'number',
                },
                {
                  type: 'boolean',
                },
                {
                  items: {
                    anyOf: [
                      {
                        type: 'string',
                      },
                      {
                        type: 'number',
                      },
                    ],
                  },
                  type: 'array',
                },
              ],
              description:
                'Value of your filter. For example `test@example.com` or `https://example.com/test/`. Can be an array for an OR query, like `["test@example.com","ok@example.com"]`',
            },
          },
          required: ['key', 'value'],
          type: 'object',
        },
        type: 'array',
      },
      filterTestAccounts: {
        default: true,
        description:
          'When true, exclude internal/test account data from results. Defaults to true.',
        type: 'boolean',
      },
      fingerprint: {
        anyOf: [
          {
            type: 'string',
          },
          {
            items: {
              type: 'string',
            },
            minItems: 1,
            type: 'array',
          },
        ],
        description: 'Filter by exact exception fingerprint hash, not fuzzy search.',
      },
      library: {
        anyOf: [
          {
            type: 'string',
          },
          {
            items: {
              type: 'string',
            },
            minItems: 1,
            type: 'array',
          },
        ],
        description: 'Filter by SDK/library value from event $lib, for example posthog-js.',
      },
      limit: {
        default: 25,
        description: 'Page size.',
        maximum: 100,
        minimum: 1,
        type: 'number',
      },
      offset: {
        default: 0,
        description: 'Pagination offset.',
        minimum: 0,
        type: 'number',
      },
      orderBy: {
        default: 'occurrences',
        description:
          'Field used to sort issues. Defaults to occurrences.\n\n* `last_seen` - last_seen\n* `first_seen` - first_seen\n* `occurrences` - occurrences\n* `users` - users\n* `sessions` - sessions',
        enum: ['last_seen', 'first_seen', 'occurrences', 'users', 'sessions'],
        type: 'string',
      },
      orderDirection: {
        default: 'DESC',
        description: 'Sort direction. Defaults to DESC.\n\n* `ASC` - ASC\n* `DESC` - DESC',
        enum: ['ASC', 'DESC'],
        type: 'string',
      },
      personId: {
        description: 'Filter by exact PostHog person UUID.',
        type: 'string',
      },
      release: {
        description:
          'Filter by exact release ID, version, or git commit ID captured in $exception_releases.',
        maxLength: 500,
        type: 'string',
      },
      searchQuery: {
        description:
          'Free-text search across exception types, values, stack frames, and email fields.',
        maxLength: 500,
        type: 'string',
      },
      status: {
        default: 'active',
        description:
          'Filter by issue status. Defaults to active.\n\n* `archived` - archived\n* `active` - active\n* `resolved` - resolved\n* `pending_release` - pending_release\n* `suppressed` - suppressed\n* `all` - all',
        enum: ['archived', 'active', 'resolved', 'pending_release', 'suppressed', 'all'],
        type: 'string',
      },
      url: {
        description: 'Filter by current URL substring.',
        maxLength: 1000,
        type: 'string',
      },
      user: {
        description: 'Search user/email text.',
        maxLength: 500,
        type: 'string',
      },
      volumeResolution: {
        default: 0,
        description: 'Number of volume buckets. Defaults to 0 for compact aggregate counts.',
        maximum: 200,
        minimum: 0,
        type: 'number',
      },
    },
    type: 'object',
  },
  'query-error-tracking-issue': {
    properties: {
      dateRange: {
        description:
          'Date range for issue impact and latest-event metadata. Defaults to the last 7 days.',
        properties: {
          date_from: {
            description:
              'Start of the date range as an ISO timestamp or relative date such as -7d. Defaults to -7d.',
            type: 'string',
          },
          date_to: {
            anyOf: [
              {
                type: 'string',
              },
              {
                type: 'null',
              },
            ],
            description:
              'End of the date range as an ISO timestamp or relative date. Defaults to now when omitted.',
          },
        },
        type: 'object',
      },
      filterTestAccounts: {
        default: true,
        description:
          'When true, exclude internal/test account data from results. Defaults to true.',
        type: 'boolean',
      },
      includeSparkline: {
        default: false,
        description:
          'Set true to include a compact numeric occurrence sparkline. Defaults to false.',
        type: 'boolean',
      },
      issueId: {
        description: 'Error tracking issue ID.',
        type: 'string',
      },
      volumeResolution: {
        default: 0,
        description: 'Volume buckets. Maximum 200.',
        maximum: 200,
        minimum: 0,
        type: 'number',
      },
    },
    required: ['issueId'],
    type: 'object',
  },
  'feature-flag-get-all': {
    properties: {
      active: {
        enum: ['STALE', 'false', 'true'],
        type: 'string',
      },
      archived: {
        description: 'Filter by archived state. When omitted, archived flags are excluded.',
        enum: ['false', 'true'],
        type: 'string',
      },
      created_by_id: {
        description:
          'Filter by the user(s) who created the feature flag. Accepts a single user ID, or a JSON-encoded / comma-separated list of user IDs to match any of them.',
        type: 'string',
      },
      eligible_for_experiment: {
        description:
          "When 'true', only return flags that can back an experiment: multivariate with 2-20 variants. Any other value is ignored.",
        enum: ['true'],
        type: 'string',
      },
      evaluation_runtime: {
        description: 'Filter feature flags by their evaluation runtime.',
        enum: ['all', 'client', 'server'],
        type: 'string',
      },
      excluded_properties: {
        description: 'JSON-encoded list of feature flag keys to exclude from the results.',
        type: 'string',
      },
      excluded_tags: {
        description:
          'JSON-encoded list of tag names to exclude. Flags carrying any of these tags are filtered out.',
        type: 'string',
      },
      has_evaluation_contexts: {
        description:
          "Filter feature flags by presence of evaluation contexts. 'true' returns only flags with at least one evaluation context, 'false' returns only flags without.",
        enum: ['false', 'true'],
        type: 'string',
      },
      key: {
        description: 'Filter by exact feature flag key match. Case insensitive.',
        type: 'string',
      },
      limit: {
        description: 'Number of results to return per page.',
        type: 'number',
      },
      offset: {
        description: 'The initial index from which to return the results.',
        type: 'number',
      },
      search: {
        description:
          'Search by feature flag key or name (case-insensitive). Use this to find the flag ID for get/update/delete tools.',
        type: 'string',
      },
      tags: {
        description: 'JSON-encoded list of tag names to filter feature flags by.',
        type: 'string',
      },
      type: {
        enum: ['boolean', 'experiment', 'multivariant', 'remote_config'],
        type: 'string',
      },
    },
    type: 'object',
  },
  'feature-flag-get-definition': {
    properties: {
      id: {
        description: 'A unique integer value identifying this feature flag.',
        type: 'number',
      },
    },
    required: ['id'],
    type: 'object',
  },
  'experiment-list': {
    properties: {
      archived: {
        description: 'Filter by archived state. Defaults to non-archived experiments only.',
        type: 'boolean',
      },
      created_by_id: {
        description:
          'Filter to experiments created by the given user(s). Accepts a single user ID, or a JSON-encoded / comma-separated list of user IDs to match any of them.',
        type: 'string',
      },
      event: {
        description:
          'Filter to experiments whose metrics reference this event name. Matches events used directly in metric queries as well as events behind any actions those metrics reference.',
        type: 'string',
      },
      excluded_tags: {
        description:
          'JSON-encoded list of tag names. Excludes experiments carrying any of the given tags, even when they also carry non-excluded tags.',
        type: 'string',
      },
      feature_flag_id: {
        description: 'Filter to experiments linked to the given feature flag ID.',
        type: 'number',
      },
      limit: {
        description: 'Number of results to return per page.',
        type: 'number',
      },
      offset: {
        description: 'The initial index from which to return the results.',
        type: 'number',
      },
      order: {
        description:
          "Field to order by. Prefix with '-' for descending. Allowlisted fields include name, created_at, updated_at, start_date, end_date, duration, and status.",
        type: 'string',
      },
      prompt_name: {
        description:
          'Filter to experiments created from an LLM prompt with this name. Matches experiments whose parameters.prompt_metadata.name equals the given value.',
        type: 'string',
      },
      search: {
        description: 'Free-text search applied to the experiment name (case-insensitive).',
        type: 'string',
      },
      status: {
        description:
          'Filter by experiment status. Values: "draft" (not yet launched), "running" (launched, flag active), "paused" (launched, flag deactivated — mutually exclusive with running), "exposure_frozen" (launched, enrollment frozen to the already-exposed cohort while metrics keep flowing), "stopped" or "complete" (both mean ended), "all" (no filter). Defaults to all non-archived experiments.',
        enum: ['all', 'complete', 'draft', 'exposure_frozen', 'paused', 'running', 'stopped'],
        type: 'string',
      },
      tags: {
        description:
          'JSON-encoded list of tag names. Returns experiments carrying at least one of the given tags, e.g. `["growth", "checkout"]`.',
        type: 'string',
      },
    },
    type: 'object',
  },
  'experiment-get': {
    properties: {
      id: {
        description: 'A unique integer value identifying this experiment.',
        type: 'number',
      },
    },
    required: ['id'],
    type: 'object',
  },
  'experiment-results-get': {
    properties: {
      id: {
        description: 'The ID of the experiment to get comprehensive results for',
        type: 'number',
      },
      refresh: {
        default: false,
        description: 'Force refresh of results instead of using cached values. Defaults to false.',
        type: 'boolean',
      },
    },
    required: ['id'],
    type: 'object',
  },
  'surveys-get-all': {
    properties: {
      archived: {
        type: 'boolean',
      },
      created_by: {
        description: 'Filter surveys by the ID of the user who created them.',
        type: 'number',
      },
      ids: {
        description: 'Multiple values may be separated by commas.',
        items: {
          type: 'string',
        },
        type: 'array',
      },
      limit: {
        description: 'Number of results to return per page.',
        type: 'number',
      },
      offset: {
        description: 'The initial index from which to return the results.',
        type: 'number',
      },
      search: {
        description:
          "Match against survey `name` and `description`. Returns exact (case-insensitive substring) matches only; if no exact match exists, returns similar (fuzzy trigram — typos, prefix-as-you-type) matches instead. Each result's `search_match_type` is `exact` or `similar`.",
        type: 'string',
      },
      status: {
        description:
          'Filter surveys by their current status.\n\n* `draft` - Draft\n* `running` - Running\n* `complete` - Complete',
        enum: ['complete', 'draft', 'running'],
        type: 'string',
      },
      type: {
        description:
          '* `popover` - popover\n* `widget` - widget\n* `external_survey` - external survey\n* `api` - api',
        enum: ['api', 'external_survey', 'popover', 'widget'],
        type: 'string',
      },
    },
    type: 'object',
  },
  'survey-get': {
    properties: {
      id: {
        description: 'A UUID string identifying this survey.',
        type: 'string',
      },
    },
    required: ['id'],
    type: 'object',
  },
  'survey-stats': {
    properties: {
      date_from: {
        description: 'Optional ISO timestamp for start date (e.g. 2024-01-01T00:00:00Z)',
        format: 'date-time',
        pattern:
          '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
        type: 'string',
      },
      date_to: {
        description: 'Optional ISO timestamp for end date (e.g. 2024-01-31T23:59:59Z)',
        format: 'date-time',
        pattern:
          '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
        type: 'string',
      },
      id: {
        description: 'A UUID string identifying this survey.',
        type: 'string',
      },
      include_per_question_stats: {
        description:
          'When true, also return per-question response counts and answer distributions. Adds one extra HogQL query per question, so leave off unless you need the breakdown.',
        type: 'boolean',
      },
    },
    required: ['id'],
    type: 'object',
  },
  'docs-search': {
    properties: {
      query: {
        description:
          'Natural-language description of what to find in the PostHog documentation. Inkeep performs hybrid (semantic + full-text) RAG, so phrase the query the way a user would ask the question.',
        type: 'string',
      },
    },
    required: ['query'],
    type: 'object',
  },
} as const satisfies Record<string, AgentToolJsonSchema>;

const posthogAgentToolDefinitions = [
  {
    id: 'execute-sql',
    description: 'Execute a read-only HogQL query against PostHog data.',
    sensitive: true,
  },
  {
    id: 'read-data-schema',
    description: 'Read the available PostHog event, entity, and property schema.',
    sensitive: false,
  },
  {
    id: 'insights-list',
    description: 'List saved insights in the current PostHog project.',
    sensitive: false,
  },
  {
    id: 'insight-get',
    description: 'Retrieve a saved insight definition by numeric id or short id.',
    sensitive: false,
  },
  {
    id: 'insight-query',
    description: 'Run a saved insight and return its query results.',
    sensitive: true,
  },
  {
    id: 'dashboards-get-all',
    description: 'List dashboards in the current PostHog project.',
    sensitive: false,
  },
  {
    id: 'dashboard-get',
    description: 'Retrieve a dashboard and its tiles by id.',
    sensitive: false,
  },
  {
    id: 'dashboard-insights-run',
    description: 'Run all insights on a dashboard and return their results.',
    sensitive: true,
  },
  {
    id: 'query-error-tracking-issues-list',
    description: 'List and aggregate error tracking issues.',
    sensitive: true,
  },
  {
    id: 'query-error-tracking-issue',
    description: 'Retrieve details and impact for an error tracking issue.',
    sensitive: true,
  },
  {
    id: 'feature-flag-get-all',
    description: 'List feature flags in the current PostHog project.',
    sensitive: false,
  },
  {
    id: 'feature-flag-get-definition',
    description: 'Retrieve a feature flag definition by id.',
    sensitive: false,
  },
  {
    id: 'experiment-list',
    description: 'List experiments in the current PostHog project.',
    sensitive: false,
  },
  {
    id: 'experiment-get',
    description: 'Retrieve an experiment by id.',
    sensitive: false,
  },
  {
    id: 'experiment-results-get',
    description: 'Retrieve comprehensive results for an experiment.',
    sensitive: true,
  },
  {
    id: 'surveys-get-all',
    description: 'List surveys in the current PostHog project.',
    sensitive: false,
  },
  {
    id: 'survey-get',
    description: 'Retrieve a survey by id.',
    sensitive: false,
  },
  {
    id: 'survey-stats',
    description: 'Retrieve response statistics for a survey.',
    sensitive: true,
  },
  {
    id: 'docs-search',
    description: 'Search the PostHog documentation.',
    sensitive: false,
  },
] as const;

export const posthogAgentToolCatalog = posthogAgentToolDefinitions.map((entry) => ({
  ...entry,
  sensitivity: 'read' as const,
  requiredScope: 'read' as const,
  inputSchema: posthogAgentToolSchemas[entry.id],
})) satisfies readonly AgentToolCatalogEntry<PosthogAgentToolRequiredScope>[];

export type PosthogAgentToolId = (typeof posthogAgentToolCatalog)[number]['id'];

export const posthogAgentToolSelectionCatalog: AgentToolSelectionCatalog = {
  selectors: posthogAgentToolCatalog.map(
    (entry): AgentToolSelector => ({
      token: entry.id,
      kind: 'standalone',
      sensitivity: entry.sensitivity,
      sensitive: entry.sensitive,
    }),
  ),
};
