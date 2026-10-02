/** Announcement, public, and private threads. A thread's messages are posted to its own id. */
const THREAD_CHANNEL_TYPES: ReadonlySet<number> = new Set([10, 11, 12]);

export function isDiscordThreadType(type: number): boolean {
  return THREAD_CHANNEL_TYPES.has(type);
}

/** Forum and media channels only hold posts: each one is a thread with a first message. */
export function isDiscordForumType(type: number): boolean {
  return type === 15 || type === 16;
}
