import type {
  AgentToolCatalogEntry,
  AgentToolJsonSchema,
  AgentToolSelectionCatalog,
  AgentToolSelector,
} from '@shipfox/api-integration-spi';

export type ClaapAgentToolRequiredScope = 'read';

// The input schemas copy Claap's own, with three changes: `workspaceId` is gone because the
// provider injects it from the connection, `format` is gone because a tool step compiles every
// schema with strict Ajv and no format plugin, and the two single-recording tools take a share
// URL as well as an ID. Claap's key is the access boundary, and the catalog is the safety
// boundary around it: the same endpoint offers write tools that Shipfox never forwards.

const datePattern = String.raw`^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))$`;

const stringArray = (description: string) => ({
  description,
  items: {type: 'string'},
  type: 'array',
});

const recordingFilterProperties = {
  companyId: stringArray('Filter by company ID matching at least one of these values.'),
  companyName: {
    description: 'Filter by company name containing this string.',
    type: 'string',
  },
  contactEmail: {
    description:
      'Filter by participant email (detected speaker or meeting attendee) containing this string.',
    type: 'string',
  },
  contactId: stringArray('Filter by contact ID matching at least one of these values.'),
  contactName: {
    description:
      'Filter by participant name (detected speaker or meeting attendee) containing this string.',
    type: 'string',
  },
  createdAt: {
    description: 'Filter by recording creation date (ISO YYYY-MM-DD).',
    properties: {
      gte: {
        description: 'Greater than or equal to this date (YYYY-MM-DD).',
        pattern: datePattern,
        type: 'string',
      },
      lte: {
        description: 'Less than or equal to this date (YYYY-MM-DD).',
        pattern: datePattern,
        type: 'string',
      },
    },
    type: 'object',
  },
  dealId: stringArray('Filter by deal ID matching at least one of these values.'),
  dealTitle: {
    description: 'Filter by deal title containing this string.',
    type: 'string',
  },
  folderId: stringArray('Filter by folder ID matching at least one of these values.'),
  folderTitle: {
    description: 'Filter by folder title containing this string.',
    type: 'string',
  },
  hasExternalSpeaker: {
    description:
      "Only include results with at least one speaker external to the user's organization (eg. client, prospects, partners)",
    type: 'boolean',
  },
  labelName: {
    description: 'Filter by label name containing this string.',
    type: 'string',
  },
  recordingId: stringArray('Filter by recording ID matching at least one of these values.'),
  recordingTitle: {
    description: 'Filter by recording title containing this string.',
    type: 'string',
  },
  userId: stringArray(
    'Filter by participant user ID (speaker or attendee) matching at least one of these values.',
  ),
};

const cursorProperty = {
  description:
    'Opaque cursor returned as `nextCursor` by a previous call. Pass the value VERBATIM (do not construct, modify, decode, or invent a cursor; it is an internal token whose format is not part of the API contract) to fetch the next page of results. Omit on the first call.',
  type: 'string',
};

const limitProperty = {
  description:
    'Maximum number of results per page (default 10, max 100). The response includes `total` (full match count) and, when more results exist, `nextCursor`. To fetch more results, ALWAYS paginate via `nextCursor`, and do not adjust filters or limits to skip past already-returned items.',
  maximum: 100,
  minimum: 1,
  type: 'number',
};

const recordingReferenceProperties = {
  recordingId: {
    description:
      'The ID of the recording. Discover it via get_recordings or search_recording_transcripts. Pass exactly one of recordingId and recordingUrl.',
    type: 'string',
  },
  recordingUrl: {
    description:
      'The Claap share URL of the recording, for example https://app.claap.io/my-call-c-<workspaceId>-<recordingId>. It must belong to the connected Claap workspace. Pass exactly one of recordingId and recordingUrl.',
    type: 'string',
  },
};

const claapAgentToolSchemas = {
  list_workspaces: {
    properties: {},
    type: 'object',
  },
  get_recordings: {
    properties: {
      cursor: cursorProperty,
      filters: {
        description: 'Filters to apply to the search.',
        properties: {
          ...recordingFilterProperties,
          source: {
            description:
              'Filter by recording source (meeting platform, call provider, upload...) matching at least one of these values.',
            items: {
              enum: [
                'Aircall',
                'Allo',
                'Api',
                'Call',
                'GoogleMeet',
                'LemlistVoip',
                'Loom',
                'MobileApp',
                'MsTeams',
                'Nooks',
                'Ringover',
                'Uploaded',
                'Zoom',
              ],
              type: 'string',
            },
            type: 'array',
          },
        },
        type: 'object',
      },
      limit: limitProperty,
      sort: {
        description:
          'Sort dimensions to apply to the search results. When omitted, results are ordered by relevance and creation date descending.',
        items: {
          properties: {
            field: {
              description:
                'Field to sort by. Use `lastActivityAt` for "what recordings have been active recently?" (most recently viewed, commented, or reacted to).',
              enum: ['createdAt', 'lastActivityAt'],
              type: 'string',
            },
            order: {
              description: 'Sort order.',
              enum: ['asc', 'desc'],
              type: 'string',
            },
          },
          required: ['field', 'order'],
          type: 'object',
        },
        type: 'array',
      },
    },
    type: 'object',
  },
  get_recording: {
    properties: recordingReferenceProperties,
    type: 'object',
  },
  get_recording_transcript: {
    properties: recordingReferenceProperties,
    type: 'object',
  },
  search_recording_transcripts: {
    properties: {
      cursor: cursorProperty,
      filters: {
        description: 'Filters to apply to the search.',
        properties: {
          ...recordingFilterProperties,
          tag: {
            description: 'Filter by tag matching at least one of these values.',
            items: {
              description:
                'CompetitorMentions: an external speaker mentioned a competitor. Objections: an external speaker raised an objection. PainPoints: an external speaker expressed a pain point. FeatureRequests: an external speaker requested a feature to be implemented.',
              enum: ['CompetitorMentions', 'FeatureRequests', 'Objections', 'PainPoints'],
              type: 'string',
            },
            type: 'array',
          },
        },
        type: 'object',
      },
      limit: limitProperty,
      search: {
        properties: {
          query: {
            description: 'The query to search for.',
            type: 'string',
          },
          type: {
            description:
              'Type of search technique. Use semantic search to find transcript chunks matching the meaning of the query. Use keyword search to find transcript chunks matching all of the provided keywords.',
            enum: ['semantic', 'keyword'],
            type: 'string',
          },
        },
        required: ['query', 'type'],
        type: 'object',
      },
    },
    required: ['search'],
    type: 'object',
  },
} as const satisfies Record<string, AgentToolJsonSchema>;

const claapAgentToolDefinitions = [
  {
    id: 'list_workspaces',
    description: 'Return the Claap workspace this connection belongs to, with its ID and name.',
    sensitive: false,
  },
  {
    id: 'get_recordings',
    description:
      'Search many recordings (captured meetings and calls) of the Claap workspace with a set of filters. Returns recording metadata ordered by relevance and creation date descending. Metadata only: it never returns summaries. To read one recording with its AI-generated summary, use get_recording.',
    sensitive: true,
  },
  {
    id: 'get_recording',
    description:
      'Get one recording (captured meeting or call) of the Claap workspace by recordingId or share URL, with its full metadata and its AI-generated summary. The summary is the cheap way to know what a meeting was about: prefer it over get_recording_transcript, which returns the entire transcript. Discover the recordingId via get_recordings or search_recording_transcripts.',
    sensitive: true,
  },
  {
    id: 'get_recording_transcript',
    description:
      'Fetch the full transcript for a recording (captured meeting or call), by recordingId or share URL.',
    sensitive: true,
  },
  {
    id: 'search_recording_transcripts',
    description:
      'Perform keyword or semantic search on the transcripts of recordings (captured meetings and calls), with optional filters on the recording metadata. Returns transcript chunks grouped by recording. Both search types paginate via `cursor`/`nextCursor`. Semantic search stops after the 1000 closest chunks; to reach further, narrow the filters (for example split the `createdAt` range). `total` is only returned for keyword search.',
    sensitive: true,
  },
] as const;

export const claapAgentToolCatalog = claapAgentToolDefinitions.map((entry) => ({
  ...entry,
  sensitivity: 'read' as const,
  requiredScope: 'read' as const,
  inputSchema: claapAgentToolSchemas[entry.id] as AgentToolJsonSchema,
})) satisfies readonly AgentToolCatalogEntry<ClaapAgentToolRequiredScope>[];

export type ClaapAgentToolId = (typeof claapAgentToolCatalog)[number]['id'];

export const claapAgentToolSelectionCatalog: AgentToolSelectionCatalog = {
  selectors: claapAgentToolCatalog.map(
    (entry): AgentToolSelector => ({
      token: entry.id,
      kind: 'standalone',
      sensitivity: entry.sensitivity,
      sensitive: entry.sensitive,
    }),
  ),
};

const WORKSPACE_SCOPED_TOOL_IDS = new Set<string>([
  'get_recordings',
  'get_recording',
  'get_recording_transcript',
  'search_recording_transcripts',
]);

export function isClaapCatalogTool(toolId: string): toolId is ClaapAgentToolId {
  return claapAgentToolCatalog.some((entry) => entry.id === toolId);
}

export function isClaapWorkspaceScopedTool(toolId: string): boolean {
  return WORKSPACE_SCOPED_TOOL_IDS.has(toolId);
}

export class ClaapRecordingUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaapRecordingUrlError';
  }
}

const CLAAP_APP_HOST = 'app.claap.io';
const recordingSegmentPattern = /-c-([A-Za-z0-9]+)-([A-Za-z0-9]+)$/;

/** Reads the Claap workspace and recording IDs from a share URL. */
export function parseClaapRecordingUrl(value: string): {workspaceId: string; recordingId: string} {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ClaapRecordingUrlError('recordingUrl is not a valid URL.');
  }
  if (url.protocol !== 'https:' || url.hostname !== CLAAP_APP_HOST) {
    throw new ClaapRecordingUrlError(`recordingUrl must be a https://${CLAAP_APP_HOST} share URL.`);
  }
  const segment = url.pathname.split('/').filter(Boolean).at(-1);
  const match = segment === undefined ? null : recordingSegmentPattern.exec(segment);
  const workspaceId = match?.[1];
  const recordingId = match?.[2];
  if (workspaceId === undefined || recordingId === undefined) {
    throw new ClaapRecordingUrlError(
      'recordingUrl does not look like a Claap recording URL. Expected .../<title>-c-<workspaceId>-<recordingId>.',
    );
  }
  return {workspaceId, recordingId};
}
