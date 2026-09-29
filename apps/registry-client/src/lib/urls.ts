import {config} from '@/config';

const TRAILING_SLASHES = /\/+$/;

/** Absolute public URL of a registry page, for canonical links and the sitemap. */
export function publicUrl(path = ''): string {
  return `${config.REGISTRY_CLIENT_PUBLIC_URL.replace(TRAILING_SLASHES, '')}${path}`;
}

/** Path of a package page, relative to the base path. */
export function packagePath(packageName: string): string {
  return `/${packageName}`;
}
