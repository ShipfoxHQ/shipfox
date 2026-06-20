import {z} from 'zod';

/**
 * A config schema fragment: the Zod shape a feature module contributes. The app
 * composes fragments from every module into one shape, then validates it once.
 */
export type ConfigShape = z.ZodRawShape;

/**
 * The two places a config value can come from. The same image serves any
 * deployment because the app reads both and lets `runtime` win:
 *
 * - `runtime` is `window.__SHIPFOX_CONFIG__`, written per deployment (the
 *   self-host Docker entrypoint, or a Vercel edge function). Keys are the
 *   SCREAMING_SNAKE form of each config key, matching the env var suffix
 *   (`apiUrl` -> `API_URL`).
 * - `build` is `import.meta.env`, baked by Vite. Keys are `VITE_`-prefixed
 *   (`VITE_API_URL`). Used by the Vercel SaaS build and in local dev.
 */
export interface ConfigSources {
  runtime?: Record<string, unknown> | undefined;
  build?: Record<string, unknown> | undefined;
}

/** One missing or invalid config key, shaped for reporting to a self-hoster. */
export interface ConfigKeyError {
  key: string;
  /** The env vars that set this key: `SHIPFOX_PUBLIC_*` (self-host), `VITE_*` (Vercel/dev). */
  envVars: string[];
  description: string | undefined;
  message: string;
}

export type ConfigResult<TConfig> =
  | {ok: true; config: TConfig}
  | {ok: false; errors: ConfigKeyError[]};

/**
 * Maps a camelCase config key to the SCREAMING_SNAKE suffix shared by its env
 * vars and its runtime-global key: `apiUrl` -> `API_URL`,
 * `datadogClientToken` -> `DATADOG_CLIENT_TOKEN`. Deriving every name from one
 * key is what keeps adding a config key to a single Zod-fragment edit.
 */
export function envNameFor(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

/** The `SHIPFOX_PUBLIC_*` then `VITE_*` env var names that feed a config key. */
export function envVarsFor(key: string): string[] {
  const suffix = envNameFor(key);
  return [`SHIPFOX_PUBLIC_${suffix}`, `VITE_${suffix}`];
}

/**
 * Resolves and validates the config from both sources in a single pass.
 *
 * For each schema key, the runtime value wins over the build value; a value
 * that is absent from both is left to the schema (its default applies, or it is
 * reported as missing). Validation is aggregated, never fail-fast, so a
 * misconfigured deployment learns about every problem at once.
 */
export function loadConfig<TShape extends ConfigShape>(
  shape: TShape,
  sources: ConfigSources,
): ConfigResult<z.infer<z.ZodObject<TShape>>> {
  const input: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    const suffix = envNameFor(key);
    const value = sources.runtime?.[suffix] ?? sources.build?.[`VITE_${suffix}`];
    if (value !== undefined) input[key] = value;
  }

  const result = z.object(shape).safeParse(input);
  if (result.success) return {ok: true, config: result.data};

  return {ok: false, errors: toKeyErrors(result.error, shape)};
}

function toKeyErrors(error: z.ZodError, shape: ConfigShape): ConfigKeyError[] {
  const byKey = new Map<string, ConfigKeyError>();
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '');
    if (byKey.has(key)) continue;
    const field = shape[key] as {description?: string} | undefined;
    byKey.set(key, {
      key,
      envVars: envVarsFor(key),
      description: field?.description,
      message: issue.message,
    });
  }
  return [...byKey.values()];
}
