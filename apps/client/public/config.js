// Runtime configuration for the Shipfox client.
//
// This default ships inside the static build and is intentionally empty, so the
// dev server and tests fall back to the build-time VITE_* values. The Docker
// image overwrites this file from SHIPFOX_PUBLIC_* environment variables at
// container start (see the app's docker-entrypoint), so one prebuilt bundle
// serves any self-hosted deployment without a rebuild.
window.__SHIPFOX_CONFIG__ = {};
