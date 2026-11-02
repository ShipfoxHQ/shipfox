import {z} from 'zod';

const looseObjectSchema = z.object({}).catchall(z.unknown());

export const sessionEntrySchema = z
  .object({
    type: z.string().min(1),
  })
  .catchall(z.unknown());

export const agentMessageSchema = z
  .object({
    type: z.string().optional(),
    role: z.string().optional(),
    content: z.unknown().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    stopReason: z.string().optional(),
    errorMessage: z.string().optional(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
    isError: z.boolean().optional(),
  })
  .catchall(z.unknown());

export const sessionMessageEntrySchema = z
  .object({
    type: z.literal('message'),
    message: agentMessageSchema,
  })
  .catchall(z.unknown());

export const contentBlockSchema = z
  .object({
    type: z.string().optional(),
  })
  .catchall(z.unknown());

export type SessionEntry = z.infer<typeof sessionEntrySchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export interface ParsedSessionEntry {
  ok: true;
  entry: SessionEntry;
}

export interface MalformedSessionEntry {
  ok: false;
  raw: string;
  reason: 'invalid-json' | 'invalid-entry';
}

export type SessionEntryParseResult = ParsedSessionEntry | MalformedSessionEntry;

export function parseSessionEntry(data: string): SessionEntryParseResult {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return {ok: false, raw: data, reason: 'invalid-json'};
  }

  const parsed = sessionEntrySchema.safeParse(json);
  if (!parsed.success) return {ok: false, raw: data, reason: 'invalid-entry'};

  return {ok: true, entry: parsed.data};
}

export function asLooseObject(value: unknown): Record<string, unknown> | null {
  const parsed = looseObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function asContentBlocks(value: unknown): ContentBlock[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const parsed = contentBlockSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
