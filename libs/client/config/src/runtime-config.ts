declare global {
  interface Window {
    // The runtime config object written before the app bundle loads. The
    // self-host Docker entrypoint (or a Vercel edge function) populates it from
    // environment variables; keys are SCREAMING_SNAKE (see envNameFor).
    __SHIPFOX_CONFIG__?: Record<string, unknown> | undefined;
  }
}

/** Reads `window.__SHIPFOX_CONFIG__`, or undefined when not in a browser. */
export function getWindowRuntimeConfig(): Record<string, unknown> | undefined {
  return typeof window === 'undefined' ? undefined : window.__SHIPFOX_CONFIG__;
}

let loaded: unknown;

/**
 * Stores the validated config as a frozen, app-wide singleton at boot. The
 * config is immutable for the lifetime of the page, so non-React code (such as
 * the API client wiring) and `useConfig` can both read it without a provider.
 */
export function setLoadedConfig(config: unknown): void {
  loaded = Object.freeze(config);
}

export function getLoadedConfig<TConfig>(): TConfig {
  if (loaded === undefined) {
    throw new Error(
      'Runtime config has not been loaded. Call loadConfig + setLoadedConfig at app boot before reading it.',
    );
  }
  return loaded as TConfig;
}

/** React accessor for the validated config. Config is immutable post-boot. */
export function useConfig<TConfig>(): TConfig {
  return getLoadedConfig<TConfig>();
}
