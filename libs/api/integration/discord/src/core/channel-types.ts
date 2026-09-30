/** Announcement, public, and private threads. A thread's messages are posted to its own id. */
const THREAD_CHANNEL_TYPES: ReadonlySet<number> = new Set([10, 11, 12]);

export function isDiscordThreadType(type: number): boolean {
  return THREAD_CHANNEL_TYPES.has(type);
}
