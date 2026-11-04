import {useRouter} from '@tanstack/react-router';
import type {MouseEvent} from 'react';

function sameOriginPath(anchor: HTMLAnchorElement): string | undefined {
  try {
    const url = new URL(anchor.href);
    return url.origin === window.location.origin
      ? `${url.pathname}${url.search}${url.hash}`
      : undefined;
  } catch {
    return undefined;
  }
}

/** A link to a Shipfox page moves the page, and the panel stays. */
export function useInAppLinks() {
  const router = useRouter();
  return (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest('a');
    if (!anchor) return;
    const path = sameOriginPath(anchor);
    if (!path) return;
    event.preventDefault();
    void router.navigate({href: path});
  };
}
