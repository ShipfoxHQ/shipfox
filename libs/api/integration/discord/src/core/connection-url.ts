export function discordConnectionExternalUrl(guildId: string): string {
  return `https://discord.com/channels/${encodeURIComponent(guildId)}`;
}
