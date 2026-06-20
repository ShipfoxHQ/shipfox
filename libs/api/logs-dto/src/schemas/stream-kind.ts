import {z} from 'zod';

/**
 * The two streamed kinds in the logs contract. The kind is part of stream
 * identity and selects both the record format and the ingest validation:
 *
 * - `log_stream`   process output, framed as the flat-`type` log record union.
 * - `agent_session` a verbatim, format-agnostic agent-session JSONL capture
 *                   (pi / Claude Agent SDK / Codex SDK); bytes are opaque.
 */
export const streamKind = z.enum(['log_stream', 'agent_session']);
export type StreamKind = z.infer<typeof streamKind>;
