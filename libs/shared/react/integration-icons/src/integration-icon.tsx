import {Icon, type IconName} from '@shipfox/react-ui/icon';
import type {ComponentProps} from 'react';
import {FALLBACK_INTEGRATION_ICON, getProviderIcon} from './provider-icons.js';

/**
 * Accepts the source strings used by connections and events; unknown values use
 * the neutral fallback icon.
 */
export function getIntegrationIcon(source: string | null | undefined): IconName {
  if (!source) return FALLBACK_INTEGRATION_ICON;
  return getProviderIcon(source) ?? FALLBACK_INTEGRATION_ICON;
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
