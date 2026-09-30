import {toSameOriginRelativeHref} from './relative-href.js';

export type RequiredActionTarget =
  | {kind: 'same-tab'; href: string}
  | {kind: 'new-tab'; href: string}
  | {kind: 'mailto'; href: string};

/**
 * Applies the required action URL rule. Returns undefined for a value that is
 * not safe to render as a link, so the caller shows the message as text.
 */
export function resolveRequiredActionTarget(
  url: string,
  applicationOrigin: string,
): RequiredActionTarget | undefined {
  const relative = toSameOriginRelativeHref(url);
  if (relative !== undefined) return {kind: 'same-tab', href: relative};

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  if (parsed.protocol === 'mailto:') return {kind: 'mailto', href: url};
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;

  parsed.username = '';
  parsed.password = '';
  return {
    kind: parsed.origin === applicationOrigin ? 'same-tab' : 'new-tab',
    href: parsed.href,
  };
}
