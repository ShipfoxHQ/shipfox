import {Icon, type IconName} from '@shipfox/react-ui';
import type {ComponentProps} from 'react';
import {PROVIDER_CATALOG} from '#provider-catalog.js';

export const FALLBACK_INTEGRATION_ICON: IconName = 'componentLine';

/**
 * Accepts the source strings used by connections and events; unknown values use
 * the neutral fallback icon.
 */
export function getIntegrationIcon(source: string | null | undefined): IconName {
  if (!source) return FALLBACK_INTEGRATION_ICON;
  return PROVIDER_CATALOG[source]?.iconName ?? FALLBACK_INTEGRATION_ICON;
}

export interface IntegrationIconProps extends Omit<ComponentProps<typeof Icon>, 'name'> {
  source: string | null | undefined;
}

/**
 * Preserves the base icon props so callers can decide whether the glyph is
 * decorative or labeled.
 */
export function IntegrationIcon({source, ...props}: IntegrationIconProps) {
  return <Icon name={getIntegrationIcon(source)} {...props} />;
}
