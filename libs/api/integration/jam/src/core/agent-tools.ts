import type {
  AgentToolCatalogEntry,
  AgentToolJsonSchema,
  AgentToolSelectionCatalog,
  AgentToolSelector,
} from '@shipfox/api-integration-spi';

export type JamAgentToolRequiredScope = 'read';

// Copied by hand from Jam's `tools/list`, minus `$schema`, the optional `intent` (Shipfox does not
// send the agent's reasoning to Jam), and `v` on `searchJams` (the provider adds `v: 1`).
const jamAgentToolSchemas = {
  getDetails: {
    type: 'object',
    properties: {
      jamId: {
        type: 'string',
        description: 'Jam identifier: a UUID or a jam.dev URL',
      },
    },
    required: ['jamId'],
    additionalProperties: false,
  },
  getConsoleLogs: {
    type: 'object',
    properties: {
      jamId: {
        type: 'string',
        description: 'Jam identifier: a UUID or a jam.dev URL',
      },
      logLevel: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['error', 'warn', 'info', 'debug'],
        },
        description: "Optional filter by log levels, e.g. ['error','warn'] for problems.",
      },
      limit: {
        type: 'number',
        description: 'Maximum number of events to return',
      },
      after: {
        type: 'number',
        description: 'Page cursor: pass the `nextCursor` from a previous response to continue',
      },
    },
    required: ['jamId'],
    additionalProperties: false,
  },
  getNetworkRequests: {
    type: 'object',
    properties: {
      jamId: {
        type: 'string',
        description: 'Jam identifier: a UUID or a jam.dev URL',
      },
      statusCode: {
        type: 'array',
        items: {
          type: 'string',
        },
        description:
          "Filter by status codes and/or classes, e.g. ['500'] or ['4xx','5xx'] for all failures",
      },
      contentType: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: "Filter by content-type substrings, e.g. ['application/json']",
      },
      host: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: "Filter by host substrings, e.g. ['api.example.com']",
      },
      method: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: "Filter by HTTP methods, e.g. ['POST','PUT','PATCH','DELETE'] for mutations",
      },
      limit: {
        type: 'number',
        description: 'Maximum number of events to return',
      },
      after: {
        type: 'number',
        description: 'Page cursor: pass the `nextCursor` from a previous response to continue',
      },
      bodies: {
        type: 'string',
        enum: ['errors', 'all'],
        description:
          "Which response bodies to include. 'errors' (default) returns bodies only for failed requests; 'all' returns every body. Both are truncated to 4KB per body.",
      },
    },
    required: ['jamId'],
    additionalProperties: false,
  },
  getUserEvents: {
    type: 'object',
    properties: {
      jamId: {
        type: 'string',
        description: 'Jam identifier: a UUID or a jam.dev URL',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of events to return',
      },
      after: {
        type: 'number',
        description: 'Page cursor: pass the `nextCursor` from a previous response to continue',
      },
    },
    required: ['jamId'],
    additionalProperties: false,
  },
  getMetadata: {
    type: 'object',
    properties: {
      jamId: {
        type: 'string',
        description: 'Jam identifier: a UUID or a jam.dev URL',
      },
    },
    required: ['jamId'],
    additionalProperties: false,
  },
  getVideoTranscript: {
    type: 'object',
    properties: {
      jamId: {
        type: 'string',
        description: 'Jam identifier: a UUID or a jam.dev URL',
      },
    },
    required: ['jamId'],
    additionalProperties: false,
  },
  getVideoChapters: {
    type: 'object',
    properties: {
      jamId: {
        type: 'string',
        description: 'Jam identifier: a UUID or a jam.dev URL',
      },
    },
    required: ['jamId'],
    additionalProperties: false,
  },
  searchJams: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description:
          'Free text. Split on whitespace into at most 8 terms; a jam matches only when every term matches somewhere (title, description, a comment, a linked issue title, the reporter\'s email or external id, or the transcript). A term made of only one or two letters or digits is matched against comments only through the whole text: a comment that contains the text as typed matches when another term has three or more letters or digits, or punctuation next to them (such as "cool" or "#12"). Terms like "#12" or "v1.2" also match comments on their own.',
      },
      textIn: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['title', 'description', 'comment', 'integration', 'transcript'],
        },
        description:
          'Which places text may match in: title, description, comment, integration, transcript. Omit to search every one.',
      },
      window: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
          },
          to: {
            type: 'string',
          },
        },
        additionalProperties: false,
        description:
          'Created-at bounds. from is inclusive, to is exclusive. Accepts an ISO date, an ISO datetime with at most millisecond precision, or a negative ISO 8601 duration such as -P7D.',
      },
      sort: {
        type: 'string',
        enum: ['newest', 'oldest', 'updated'],
        description:
          'newest (created_at descending, the default), oldest (created_at ascending), updated (updated_at descending).',
      },
      page: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
          },
          cursor: {
            type: 'string',
            minLength: 1,
          },
        },
        additionalProperties: false,
        description:
          'Paging. limit is between 1 and 250 and defaults to 20; cursor is the opaque value the previous page returned.',
      },
      options: {
        type: 'object',
        properties: {
          count: {
            type: 'string',
            enum: ['exact', 'none'],
          },
        },
        additionalProperties: false,
        description:
          'count: none skips the count query (default); exact returns the total match count, at about the cost of a second search.',
      },
      where: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
            },
            op: {
              type: 'string',
            },
            value: {},
          },
          required: ['field', 'op'],
          additionalProperties: false,
        },
        description:
          "Filters, all ANDed. Each entry is { field, op, value }. Negation is ne / notIn on a leaf; there is no or and no not node.\nid (eq|ne|in|notIn): The jam itself, as a UUID or a jam.dev link.\nauthor (eq|ne|in|notIn): Who recorded the jam, as a user UUID or the literal 'me' for the signed-in viewer.\nfolder (eq|ne|in|notIn): The folder the jam sits in, as a folder UUID or short id. 'eq null' is the team root; 'ne' and 'notIn' count root jams as matching, since a jam with no folder is not in the named one.\ntype (eq|ne|in|notIn): What was captured.\norigin (eq|ne|in|notIn): The capture surface. extension_chrome is the browser extension, native_macos the macOS app and native_cli its command line, recording_link a shareable recorder link, web_recorder the recorder opened directly, mobile_ios and mobile_android the phone apps, csup_intercom the Intercom support widget, dashboard a jam created in the app. Some are no longer produced but still sit on older jams, so every member stays filterable.\ncapturedUrl (contains): Substring of the page URL the jam was captured on, matched case-insensitively.\nrecordingLink (eq|ne|in|notIn): The recording link the jam was submitted through, as its id or the public id its URL carries.\nrecordingLink.reference (eq|ne|in|notIn|contains): The free-form label on the recording link the jam came through, the one that records where the link was handed out.\nintegration.name (eq|ne|in|notIn): The provider of an issue created from the jam. Only entities attached to the jam itself count, never one attached to a comment on it.\nintegration.id (eq|ne|in|notIn): The provider's own key for an issue created from the jam, such as 'JIRA-123'. Matches the provider id or its alias.\ncountry (eq|ne|in|notIn): Where the jam was recorded, as an uppercase ISO 3166-1 alpha-2 code (US, DE, PL).\nbrowser (eq|ne|in|notIn): Browser name from the recorded system info, matched exactly against the name the user agent reported, so 'Mobile Safari' and 'Safari' are different values. Any value is accepted; the listed ones are what most rows carry.\nos (eq|ne|in|notIn): Operating system, matched exactly. The CPU architecture some browsers append to the name is ignored, so macOS matches a jam recorded on 'macOS (arm)'. Any value is accepted; use in to cover several spellings at once.\nisIncognito (eq|ne): Whether the jam was recorded in a private browsing window.\nisCharging (eq|ne): Whether the device was plugged in while the jam was recorded. Jams that recorded no battery reading match neither value.\nconnection (eq|ne|in|notIn): Effective network type from the recorded system info, matched exactly. Any value is accepted.",
      },
    },
    additionalProperties: false,
  },
  getScreenshots: {
    type: 'object',
    properties: {
      jamId: {
        type: 'string',
        description: 'Jam identifier: a UUID or a jam.dev URL',
      },
    },
    required: ['jamId'],
    additionalProperties: false,
  },
  getFrames: {
    type: 'object',
    properties: {
      jamId: {
        type: 'string',
        description: 'Jam identifier: a UUID or a jam.dev URL',
      },
      at: {
        type: 'array',
        items: {
          type: 'integer',
          minimum: 0,
        },
        minItems: 1,
        description:
          'Explicit list of timestamps in milliseconds to capture. Use exactly one mode: this, a window, or `overview`.',
      },
      fromMs: {
        type: 'integer',
        minimum: 0,
        description: 'Window start in milliseconds (use with toMs and count)',
      },
      toMs: {
        type: 'integer',
        minimum: 0,
        description: 'Window end in milliseconds (use with fromMs and count)',
      },
      count: {
        type: 'integer',
        minimum: 1,
        description:
          'Number of evenly-spaced frames to sample across the window (use with fromMs and toMs)',
      },
      overview: {
        type: 'boolean',
        description:
          'Set to true to get one labeled grid of frames evenly spaced across the whole video, for orienting on a visual Jam before requesting specific times. Use instead of `at` or a window, not alongside them.',
      },
      size: {
        type: 'string',
        enum: ['small', 'medium', 'large'],
        default: 'medium',
        description: 'Frame height: small=360p, medium=720p (default), large=1080p',
      },
    },
    required: ['jamId'],
    additionalProperties: false,
  },
} as const satisfies Record<string, AgentToolJsonSchema>;

// Jam's own descriptions tell the agent to post a comment on the Jam. The catalog has no write
// tool, so each description is written here instead.
const jamAgentToolDefinitions = [
  {
    id: 'getDetails',
    description:
      'Read a Jam bug report: reporter, title, description, type (video or screenshot), page URL, device and browser, event counts and comments. Call it first, before the other Jam tools. The Jam ID can be a UUID or a jam.dev link.',
    sensitive: false,
  },
  {
    id: 'getConsoleLogs',
    description:
      'Read the browser console entries captured in a Jam: errors, warnings, info and debug messages, with stack traces. Filter by level. The response reports the `total` of matching entries; when fewer are returned, narrow the filter or page with `after` and the `nextCursor` of the previous response.',
    sensitive: true,
  },
  {
    id: 'getNetworkRequests',
    description:
      'Read the network requests captured in a Jam: URL, method, status, content type, timing, errors and request and response bodies. Filters combine with AND; values within one filter combine with OR. Response bodies are included for failed requests only unless `bodies` is `all`, and every body is cut at 4 KB. Request headers and cookies are not captured. The response reports the `total` of matching requests; page with `after` and `nextCursor`.',
    sensitive: true,
  },
  {
    id: 'getUserEvents',
    description:
      "Read the reporter's clicks, typed input, form submissions and navigation in a Jam, in order. This is the list of steps to reproduce the bug. The whole timeline is returned by default; use `limit` to cap it and `after` with `nextCursor` to page.",
    sensitive: true,
  },
  {
    id: 'getMetadata',
    description:
      "Read the custom key-value metadata that the reporter's app set with `jam.metadata()`, such as user IDs, app versions and feature flags. When the app set none, the answer is a short text saying so.",
    sensitive: true,
  },
  {
    id: 'getVideoTranscript',
    description:
      'Read what the reporter said while recording a video Jam, as WebVTT with timestamps. Available only for video Jams recorded with the microphone on.',
    sensitive: true,
  },
  {
    id: 'getVideoChapters',
    description:
      'Read the generated chapters of a video Jam: titled segments with start and end times. `status` is `ready` when chapters exist, `not_requested` when none were generated, and `skipped` when the video is shorter than 45 seconds. Instant Replay Jams have no video.',
    sensitive: false,
  },
  {
    id: 'searchJams',
    description:
      'Search the Jams of the Jam workspace that the connection belongs to. `text` matches every term against titles, descriptions, comments, linked issue titles, reporter emails and transcripts; `textIn` narrows where. `where` is a list of `{field, op, value}` filters, all combined with AND; its description lists each field and operator. Each result carries a `url` to a Jam.',
    sensitive: false,
  },
  {
    id: 'getScreenshots',
    result: 'image',
    description:
      'Read the screenshots and image attachments of a screenshot Jam, as images. Works only for Jams of type screenshot: check the type with getDetails first. Agent steps only; a tool step cannot read images.',
    sensitive: true,
  },
  {
    id: 'getFrames',
    result: 'image',
    description:
      'Read still frames of a video Jam as images, to see what was on screen. Use exactly one mode: `overview: true` for one labeled grid of frames spread over the whole video, `at` for specific timestamps in milliseconds, or `fromMs`, `toMs` and `count` for evenly spaced frames over a window. At most 30 frames per call. `size` is small (360p), medium (720p, the default) or large (1080p); larger frames cost more context. Works only for video Jams. Agent steps only; a tool step cannot read images.',
    sensitive: true,
  },
] as const;

export const jamAgentToolCatalog = jamAgentToolDefinitions.map((entry) => ({
  ...entry,
  sensitivity: 'read' as const,
  requiredScope: 'read' as const,
  inputSchema: jamAgentToolSchemas[entry.id],
})) satisfies readonly AgentToolCatalogEntry<JamAgentToolRequiredScope>[];

export type JamAgentToolId = (typeof jamAgentToolCatalog)[number]['id'];

export const jamAgentToolSelectionCatalog: AgentToolSelectionCatalog = {
  selectors: jamAgentToolCatalog.map(
    (entry): AgentToolSelector => ({
      token: entry.id,
      kind: 'standalone',
      sensitivity: entry.sensitivity,
      sensitive: entry.sensitive,
    }),
  ),
};
