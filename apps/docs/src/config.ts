import {createConfig, host, str, url} from '@shipfox/config';

export type DocsConfig = {
  VERCEL_ENV: 'development' | 'preview' | 'production' | undefined;
  VERCEL_URL: string | undefined;
  NEXT_PUBLIC_VERCEL_ENV: 'development' | 'preview' | 'production' | undefined;
  NEXT_PUBLIC_VERCEL_URL: string | undefined;
  NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: string | undefined;
  NEXT_PUBLIC_BASE_PATH: string;
  API_PUBLIC_URL: string;
  OPENROUTER_API_KEY: string | undefined;
  ASK_AI_MODEL: string;
};

export function loadConfig(update?: Partial<NodeJS.ProcessEnv>): DocsConfig {
  return createConfig(
    {
      VERCEL_ENV: str({
        choices: ['development', 'preview', 'production'],
        default: undefined,
        desc: 'Vercel deployment environment used to choose the canonical docs origin.',
      }),
      VERCEL_URL: host({
        default: undefined,
        desc: 'Hostname of the current Vercel deployment used for preview docs URLs.',
      }),
      NEXT_PUBLIC_VERCEL_ENV: str({
        choices: ['development', 'preview', 'production'],
        default: undefined,
        desc: 'Public Vercel deployment environment used when the server variable is unavailable.',
      }),
      NEXT_PUBLIC_VERCEL_URL: host({
        default: undefined,
        desc: 'Public hostname of the current Vercel deployment used when the server variable is unavailable.',
      }),
      NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: host({
        default: undefined,
        desc: 'Public hostname of the Vercel project production deployment used for canonical docs URLs.',
      }),
      NEXT_PUBLIC_BASE_PATH: str({
        default: '',
        desc: 'Path prefix applied to externally generated docs URLs, such as /docs in production.',
      }),
      API_PUBLIC_URL: url({
        default: 'https://api.shipfox.io',
        desc: 'Public Shipfox API base URL used to load the product catalog. Set this to the staging API URL when previewing a staging catalog.',
      }),
      OPENROUTER_API_KEY: str({
        default: undefined,
        desc: 'OpenRouter API key used to answer questions in the Ask AI panel. Leave it unset to hide the panel and disable the chat route.',
      }),
      ASK_AI_MODEL: str({
        default: 'z-ai/glm-5.3-flash',
        desc: 'Model that answers Ask AI questions. Accepts any OpenRouter model ID that supports tool calling, such as deepseek/deepseek-v4.1-flash for another open-weight option or anthropic/claude-sonnet-5 to fall back to a first-party model.',
      }),
    },
    update,
  ) as unknown as DocsConfig;
}

// Next replaces this public env access with the `env` value from next.config.mjs
// at build time. Pass these values explicitly so the runtime config keeps the
// production path and canonical origin after validation.
const nextBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
const nextProjectProductionUrl = process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
export const config = loadConfig(
  nextBasePath === undefined && nextProjectProductionUrl === undefined
    ? undefined
    : {
        ...(nextBasePath === undefined ? {} : {NEXT_PUBLIC_BASE_PATH: nextBasePath}),
        ...(nextProjectProductionUrl === undefined
          ? {}
          : {NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: nextProjectProductionUrl}),
      },
);
