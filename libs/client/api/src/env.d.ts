interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface ShipfoxRuntimeConfig {
  readonly apiUrl?: string;
}

// Injected by /config.js before the app bundle loads. The client Docker image
// rewrites that file from environment at container start (see the app's
// docker-entrypoint), so one prebuilt bundle serves any deployment.
declare var __SHIPFOX_CONFIG__: ShipfoxRuntimeConfig | undefined;
