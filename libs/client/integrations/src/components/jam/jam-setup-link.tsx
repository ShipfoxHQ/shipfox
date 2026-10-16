export const JAM_SETUP_URL = 'https://www.shipfox.io/docs/integrations/jam/setup';

export function JamTokenFieldDescription() {
  return (
    <>
      Create it in Jam under Settings → MCP with MCP read access.{' '}
      <a
        href={JAM_SETUP_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="text-foreground-highlight-interactive underline"
      >
        Read the setup guide
      </a>
      .
    </>
  );
}

export function jamTokenFieldError(value: string): string | undefined {
  return value.trim().length > 0 ? undefined : 'Personal access token is required.';
}
