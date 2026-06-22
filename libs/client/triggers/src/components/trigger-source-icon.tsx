import {getIntegrationIcon} from '@shipfox/client-integrations';
import {Icon, type IconName} from '@shipfox/react-ui';
import type {ComponentProps} from 'react';

/**
 * Icons for the trigger sources the integration catalog does not own. Integration
 * sources (github, sentry, …) resolve through {@link getIntegrationIcon}; these are
 * the system sources a run can carry instead — a person firing it (`manual`) or a
 * schedule (`cron`).
 */
const SYSTEM_TRIGGER_SOURCE_ICONS: Record<string, IconName> = {
  manual: 'cursorLine',
  cron: 'timeLine',
};

/**
 * Resolves a run `trigger_source` (or a trigger event `source`) to its icon.
 * Recognizes the system sources `manual` and `cron`, and delegates every other
 * source to the integration catalog, inheriting its neutral fallback for unknown
 * providers.
 */
export function getTriggerSourceIcon(source: string | null | undefined): IconName {
  const systemIcon = source ? SYSTEM_TRIGGER_SOURCE_ICONS[source] : undefined;
  return systemIcon ?? getIntegrationIcon(source);
}

export interface TriggerSourceIconProps extends Omit<ComponentProps<typeof Icon>, 'name'> {
  /** A run `trigger_source` or trigger event `source`: `manual`, `cron`, or an integration provider. */
  source: string | null | undefined;
}

/**
 * Renders the icon for what triggered a run: a person (`manual`), a schedule
 * (`cron`), or the integration that delivered the event. A thin wrapper over
 * {@link Icon} — size, color, and accessibility props pass straight through. Mark
 * it `aria-hidden` when an adjacent label already names the source; pass an
 * `aria-label` when the icon is the only thing identifying it.
 */
export function TriggerSourceIcon({source, ...props}: TriggerSourceIconProps) {
  return <Icon name={getTriggerSourceIcon(source)} {...props} />;
}
