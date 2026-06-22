import {Icon, type IconName} from '@shipfox/react-ui';
import type {ComponentProps} from 'react';
import {PROVIDER_CATALOG} from '#provider-catalog.js';

/** Shown for sources with no catalog entry (an unknown or not-yet-cataloged provider). */
export const FALLBACK_INTEGRATION_ICON: IconName = 'componentLine';

/**
 * Resolves an integration source to its icon, reading the central
 * {@link PROVIDER_CATALOG} so each integration declares its icon in one place. The
 * source is the same namespace everywhere it appears: a connection `provider`, a
 * run `trigger_source`, or a trigger event `source`. Unknown sources fall back to
 * a neutral component glyph. Single source of truth so call sites never
 * re-implement the lookup + fallback.
 */
export function getIntegrationIcon(source: string | null | undefined): IconName {
  if (!source) return FALLBACK_INTEGRATION_ICON;
  return PROVIDER_CATALOG[source]?.iconName ?? FALLBACK_INTEGRATION_ICON;
}

export interface IntegrationIconProps extends Omit<ComponentProps<typeof Icon>, 'name'> {
  /** Integration source: a connection provider, a run `trigger_source`, or a trigger event `source`. */
  source: string | null | undefined;
}

/**
 * Renders the catalog icon for an integration source with the shared fallback
 * baked in. A thin wrapper over {@link Icon}: size, color, and accessibility props
 * (such as `aria-label`) pass straight through. Mark it `aria-hidden` when an
 * adjacent text label already names the source; pass an `aria-label` when the icon
 * is the only thing identifying the source.
 */
export function IntegrationIcon({source, ...props}: IntegrationIconProps) {
  return <Icon name={getIntegrationIcon(source)} {...props} />;
}
