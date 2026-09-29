import {z} from 'zod';

const tokenResponseSchema = z.object({value: z.string().min(1)});

/**
 * Requests a GitHub Actions OIDC token for `audience`. The runner exposes the
 * request URL and bearer only to jobs with `id-token: write`.
 */
export async function requestGithubOidcToken({
  audience,
  env = process.env,
  fetch = globalThis.fetch,
}: {
  audience: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch | undefined;
}): Promise<string> {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!(url && bearer)) {
    throw new Error(
      'Publishing needs a GitHub Actions OIDC token. Run it in a job with `id-token: write`.',
    );
  }
  const requestUrl = new URL(url);
  requestUrl.searchParams.set('audience', audience);
  const response = await fetch(requestUrl, {headers: {authorization: `Bearer ${bearer}`}});
  if (!response.ok) {
    throw new Error(`GitHub refused the OIDC token request with status ${response.status}`);
  }
  return tokenResponseSchema.parse(await response.json()).value;
}
