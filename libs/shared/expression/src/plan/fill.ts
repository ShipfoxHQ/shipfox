import {type AvailabilitySite, availabilitySites} from '../workflow-context/workflow-context.js';

export function shouldFillAtSite(fillTarget: string, site: AvailabilitySite): boolean {
  const fillTargetIndex = availabilitySites.indexOf(fillTarget as AvailabilitySite);
  if (fillTargetIndex < 0) return false;

  return fillTargetIndex <= availabilitySites.indexOf(site);
}
