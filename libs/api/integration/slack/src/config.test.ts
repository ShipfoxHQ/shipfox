const slackEnvNames = [
  'SLACK_OAUTH_CLIENT_ID',
  'SLACK_OAUTH_CLIENT_SECRET',
  'SLACK_SIGNING_SECRET',
  'SLACK_OAUTH_REDIRECT_URL',
] as const;

describe('slack config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('exports validated Slack config from the package root', async () => {
    vi.stubEnv('SLACK_API_BASE_URL', undefined);
    vi.resetModules();

    const {config} = await import('#index.js');

    for (const name of slackEnvNames) expect(config[name]).toBe(process.env[name]);
    expect(config.SLACK_API_BASE_URL).toBe('https://slack.com/api');
  });

  it('accepts a compatible Slack API base URL override', async () => {
    vi.stubEnv('SLACK_API_BASE_URL', 'https://slack-api.example.test');
    vi.resetModules();

    const {config} = await import('#index.js');

    expect(config.SLACK_API_BASE_URL).toBe('https://slack-api.example.test');
  });
});
