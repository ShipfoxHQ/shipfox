const DEFAULT_APP_USERNAME = 'shipfox-e2e';
const BOT_SUFFIX = '[bot]';

/**
 * The login the GitHub App acts as. The API finds its own pending reviews by this login, so it
 * follows `GITHUB_APP_USERNAME`, which the E2E harness sets to the same default.
 */
export function botLogin(): string {
  const configured = process.env.GITHUB_APP_USERNAME?.trim();
  const username = configured ? configured : DEFAULT_APP_USERNAME;
  return username.toLowerCase().endsWith(BOT_SUFFIX) ? username : `${username}${BOT_SUFFIX}`;
}
